use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::ConfigError;

/// Polar organization ID. Not a secret — it's required on every
/// customer-portal request but carries no authority on its own.
pub const ORGANIZATION_ID: &str = "49866fe3-bb17-492d-abb5-81f7a246f888";

/// Sandbox during development; switch to `https://api.polar.sh/v1` for a
/// production release.
const API_BASE: &str = "https://sandbox-api.polar.sh/v1";

/// Local cache is trusted for this long before the app insists on a fresh
/// validation call, so the license still works while offline.
const REVALIDATE_AFTER_HOURS: i64 = 48;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LicenseStatus {
    #[default]
    Inactive,
    Active,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LicenseStore {
    pub key: Option<String>,
    pub activation_id: Option<String>,
    pub device_label: Option<String>,
    pub last_validated_at: Option<DateTime<Utc>>,
    pub status: LicenseStatus,
}

impl LicenseStore {
    /// Whether paid features should be unlocked right now, without making a
    /// network call. `refresh` should still be called on launch to catch
    /// revocations, but this is what every feature gate checks.
    pub fn is_licensed(&self) -> bool {
        self.status == LicenseStatus::Active && self.activation_id.is_some()
    }

    pub fn needs_revalidation(&self) -> bool {
        match self.last_validated_at {
            Some(at) => Utc::now() - at > chrono::Duration::hours(REVALIDATE_AFTER_HOURS),
            None => true,
        }
    }
}

#[derive(Debug, Error)]
pub enum LicenseError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("No license key is activated on this device")]
    NotActivated,
    #[error("{0}")]
    Api(String),
}

pub fn license_path() -> Result<PathBuf, LicenseError> {
    let dir = crate::config::config_dir().map_err(config_error)?;
    Ok(dir.join("license.json"))
}

fn config_error(e: ConfigError) -> LicenseError {
    match e {
        ConfigError::Io(e) => LicenseError::Io(e),
        ConfigError::Json(e) => LicenseError::Json(e),
    }
}

pub fn load() -> Result<LicenseStore, LicenseError> {
    let path = license_path()?;
    if !path.exists() {
        return Ok(LicenseStore::default());
    }
    let contents = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&contents)?)
}

pub fn save(store: &LicenseStore) -> Result<(), LicenseError> {
    let path = license_path()?;
    let contents = serde_json::to_string_pretty(store)?;
    fs::write(path, contents)?;
    Ok(())
}

fn device_label() -> String {
    whoami::devicename()
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

#[derive(Serialize)]
struct ActivateRequest<'a> {
    key: &'a str,
    organization_id: &'a str,
    label: &'a str,
}

#[derive(Deserialize)]
struct ActivateResponse {
    id: String,
}

#[derive(Serialize)]
struct ValidateRequest<'a> {
    key: &'a str,
    organization_id: &'a str,
    activation_id: &'a str,
}

#[derive(Deserialize)]
struct LicenseKeyStatus {
    status: String,
}

#[derive(Deserialize)]
struct ValidateResponse {
    license_key: LicenseKeyStatus,
}

#[derive(Serialize)]
struct DeactivateRequest<'a> {
    key: &'a str,
    organization_id: &'a str,
    activation_id: &'a str,
}

async fn api_error(response: reqwest::Response) -> LicenseError {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::NOT_FOUND {
        LicenseError::Api("Invalid license key".into())
    } else {
        LicenseError::Api(format!("Polar API error ({status}): {body}"))
    }
}

/// Activates `key` on this device (consuming one of its device slots) and
/// persists the resulting activation so future launches can validate it.
pub async fn activate(key: &str) -> Result<LicenseStore, LicenseError> {
    let label = device_label();
    let response = client()
        .post(format!("{API_BASE}/customer-portal/license-keys/activate"))
        .json(&ActivateRequest { key, organization_id: ORGANIZATION_ID, label: &label })
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    let activated: ActivateResponse = response.json().await?;

    let store = LicenseStore {
        key: Some(key.to_string()),
        activation_id: Some(activated.id),
        device_label: Some(label),
        last_validated_at: Some(Utc::now()),
        status: LicenseStatus::Active,
    };
    save(&store)?;
    Ok(store)
}

/// Re-checks the currently activated license against Polar. On a network
/// error the cached `store` is returned unchanged so the app keeps working
/// offline; only an explicit "invalid"/"not found" response downgrades it.
pub async fn refresh(store: LicenseStore) -> Result<LicenseStore, LicenseError> {
    let (Some(key), Some(activation_id)) = (store.key.clone(), store.activation_id.clone())
    else {
        return Err(LicenseError::NotActivated);
    };

    let response = client()
        .post(format!("{API_BASE}/customer-portal/license-keys/validate"))
        .json(&ValidateRequest { key: &key, organization_id: ORGANIZATION_ID, activation_id: &activation_id })
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(_) => return Ok(store),
    };

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        let invalid = LicenseStore {
            status: LicenseStatus::Invalid,
            last_validated_at: Some(Utc::now()),
            ..store
        };
        save(&invalid)?;
        return Ok(invalid);
    }
    if !response.status().is_success() {
        return Ok(store);
    }

    let validated: ValidateResponse = match response.json().await {
        Ok(v) => v,
        Err(_) => return Ok(store),
    };

    let status = if validated.license_key.status == "granted" {
        LicenseStatus::Active
    } else {
        LicenseStatus::Invalid
    };
    let refreshed = LicenseStore { status, last_validated_at: Some(Utc::now()), ..store };
    save(&refreshed)?;
    Ok(refreshed)
}

/// Frees this device's activation slot on Polar and clears the local state,
/// so the same key can be activated on another device right away.
pub async fn deactivate(store: LicenseStore) -> Result<LicenseStore, LicenseError> {
    let (Some(key), Some(activation_id)) = (store.key.clone(), store.activation_id.clone())
    else {
        return Err(LicenseError::NotActivated);
    };

    let response = client()
        .post(format!("{API_BASE}/customer-portal/license-keys/deactivate"))
        .json(&DeactivateRequest { key: &key, organization_id: ORGANIZATION_ID, activation_id: &activation_id })
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(api_error(response).await);
    }

    let cleared = LicenseStore::default();
    save(&cleared)?;
    Ok(cleared)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_store_is_not_licensed() {
        assert!(!LicenseStore::default().is_licensed());
    }

    #[test]
    fn needs_revalidation_when_never_validated() {
        assert!(LicenseStore::default().needs_revalidation());
    }

    #[test]
    fn does_not_need_revalidation_right_after_validating() {
        let store = LicenseStore { last_validated_at: Some(Utc::now()), ..Default::default() };
        assert!(!store.needs_revalidation());
    }

    #[test]
    fn needs_revalidation_after_the_cache_window() {
        let store = LicenseStore {
            last_validated_at: Some(Utc::now() - chrono::Duration::hours(REVALIDATE_AFTER_HOURS + 1)),
            ..Default::default()
        };
        assert!(store.needs_revalidation());
    }

    #[test]
    fn is_licensed_requires_both_active_status_and_activation_id() {
        let store = LicenseStore { status: LicenseStatus::Active, ..Default::default() };
        assert!(!store.is_licensed());
    }

    #[test]
    fn roundtrip_serialization() {
        let store = LicenseStore {
            key: Some("KEY".into()),
            activation_id: Some("ACT".into()),
            device_label: Some("DESKTOP".into()),
            last_validated_at: Some(Utc::now()),
            status: LicenseStatus::Active,
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: LicenseStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.key, store.key);
        assert_eq!(back.activation_id, store.activation_id);
        assert!(back.is_licensed());
    }
}
