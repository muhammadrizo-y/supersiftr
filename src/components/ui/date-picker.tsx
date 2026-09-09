"use client"

import * as React from "react"
import { parseDate } from "chrono-node"
import { format, parseISO } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function formatDisplay(date: Date | undefined): string {
  if (!date) return ""
  return format(date, "PPP")
}

function toISO(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

function DatePicker({
  value,
  onChange,
  placeholder = "In 2 days",
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [date, setDate] = React.useState<Date | undefined>(() =>
    value ? parseISO(value) : undefined
  )
  const [text, setText] = React.useState(() =>
    value ? formatDisplay(parseISO(value)) : ""
  )

  const trimmed = text.trim()
  const parsed = trimmed === "" ? undefined : parseDate(trimmed)
  const statusText =
    trimmed === "" ? "" : parsed ? `→ ${formatDisplay(parsed)}` : "Invalid date"

  function handleInput(raw: string) {
    setText(raw)
    if (raw.trim() === "") {
      setDate(undefined)
      onChange("")
      return
    }
    const next = parseDate(raw.trim())
    if (next) {
      setDate(next)
      onChange(toISO(next))
    }
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <InputGroup className="w-72 shrink-0">
        <InputGroupInput
          value={text}
          placeholder={placeholder}
          onChange={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <InputGroupButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Select date"
                  className="outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-ring/50 data-popup-open:border-ring data-popup-open:outline-3 data-popup-open:outline-ring/50"
                />
              }
            >
              <CalendarIcon className="size-3.5" />
              <span className="sr-only">Select date</span>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto overflow-hidden p-0"
              align="end"
              sideOffset={8}
            >
              <Calendar
                mode="single"
                selected={date}
                captionLayout="dropdown"
                defaultMonth={date}
                onSelect={(d) => {
                  setDate(d)
                  setText(d ? formatDisplay(d) : "")
                  onChange(d ? toISO(d) : "")
                  setOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </InputGroupAddon>
      </InputGroup>
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          parsed ? "text-muted-foreground" : "text-destructive"
        )}
      >
        {statusText}
      </span>
    </div>
  )
}

export { DatePicker }