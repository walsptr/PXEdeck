"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  hostnamePlan,
  type Context,
  type FormState,
  type HostnameForm,
} from "@/components/host-config/form-state"
import { PlanTable } from "@/components/host-config/plan-table"
import { HOSTNAME_TOKENS } from "@/lib/hostname"
import type { SectionKey } from "@/lib/host-config"

export function TabHostname({
  form,
  dirty,
  onChange,
  ctx,
}: {
  form: FormState
  dirty: Set<SectionKey>
  onChange: (v: Partial<HostnameForm>) => void
  ctx: Context
}) {
  const value = form.hostname
  const bulk = ctx.hosts.length > 1
  const rows = hostnamePlan(form, dirty, ctx)
  const templateRef = React.useRef<HTMLInputElement>(null)

  function insertToken(token: string) {
    const el = templateRef.current
    const start = el?.selectionStart ?? value.template.length
    const end = el?.selectionEnd ?? value.template.length
    const next =
      value.template.slice(0, start) + token + value.template.slice(end)
    onChange({ template: next })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  if (!bulk) {
    const err = rows[0]?.error
    const showErr = Boolean(err && value.name) || undefined
    return (
      <FieldGroup>
        <Field data-invalid={showErr}>
          <FieldLabel htmlFor="hn-name">Hostname</FieldLabel>
          <Input
            id="hn-name"
            className="type-data"
            placeholder="node-01"
            value={value.name}
            aria-invalid={showErr}
            onChange={(e) => onChange({ name: e.target.value.toLowerCase() })}
          />
          {err && value.name ? (
            <FieldError>{err}</FieldError>
          ) : (
            <FieldDescription>
              RFC 1123: huruf kecil, angka dan &apos;-&apos;, maksimal 63
              karakter. Hostname final boleh diganti automation pre-req.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>
    )
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="hn-template">Pola hostname</FieldLabel>
        <Input
          ref={templateRef}
          id="hn-template"
          className="type-data"
          value={value.template}
          onChange={(e) => onChange({ template: e.target.value })}
        />
        <div className="flex flex-wrap gap-1.5">
          {HOSTNAME_TOKENS.map((t) => (
            <Tooltip key={t.token}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="type-data"
                  onClick={() => insertToken(t.token)}
                >
                  {t.token}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.help}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <FieldDescription>
          Contoh: <span className="type-data text-xs">node-{"{index:02}"}</span>
          , <span className="type-data text-xs">web-{"{mac_suffix}"}</span>,{" "}
          <span className="type-data text-xs">
            {"{prefix}-{ip_last_octet}"}
          </span>
          . {"{ip_last_octet}"} memakai rencana IP dari tab Network bila ikut
          disimpan.
        </FieldDescription>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="hn-prefix">Prefix</FieldLabel>
          <Input
            id="hn-prefix"
            className="type-data"
            placeholder="compute"
            value={value.prefix}
            onChange={(e) => onChange({ prefix: e.target.value.toLowerCase() })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="hn-start">Index awal</FieldLabel>
          <Input
            id="hn-start"
            type="number"
            min={0}
            className="type-data"
            value={value.startIndex}
            onChange={(e) =>
              onChange({ startIndex: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </Field>
      </div>
      <PlanTable
        hosts={ctx.hosts}
        rows={rows.map((r) => ({
          hostId: r.hostId,
          value: r.hostname,
          error: r.error,
        }))}
        valueLabel="Hostname baru"
        currentOf={(h) => h.hostname}
      />
    </FieldGroup>
  )
}
