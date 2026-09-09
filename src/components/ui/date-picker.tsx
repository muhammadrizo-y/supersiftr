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

  function handleInput(raw: string) {
    setText(raw)
    const trimmed = raw.trim()
    if (trimmed === "") {
      setDate(undefined)
      onChange("")
      return
    }
    const parsed = parseDate(trimmed)
    if (parsed) {
      setDate(parsed)
      onChange(toISO(parsed))
    }
  }

  return (
    <InputGroup className={cn("has-[>[data-align=inline-end]]:[&>input]:pr-2", className)}>
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
  )
}

export { DatePicker }