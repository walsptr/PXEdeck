"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  defaultIpRange,
  ipPlan,
  mgmtOf,
  parseVlan,
  requiredPrefix,
  staticNetworkOf,
  vlanNetworksOf,
  vlanPatch,
  type Context,
  type NetForm,
} from "@/components/host-config/form-state"
import { IpText } from "@/components/host-config/ip-text"
import { PlanTable } from "@/components/host-config/plan-table"
import { isHostInSubnet, isIpv4, isVlanNetwork } from "@/lib/net"

export function TabNetwork({
  value,
  onChange,
  ctx,
}: {
  value: NetForm
  onChange: (v: Partial<NetForm>) => void
  ctx: Context
}) {
  const bulk = ctx.hosts.length > 1
  const [dnsDraft, setDnsDraft] = React.useState("")
  const plan = value.mode === "static" ? ipPlan(value, ctx) : []
  // Subnet aktif dari server (CR-3-2), bukan konstanta lab.
  const mgmt = mgmtOf(ctx)
  const [lo, hi] = mgmt.dynamicRange
  // M7 (DEC-024 §4): VLAN terdaftar → IP/prefix/gateway mengikuti subnet VLAN itu.
  const net = staticNetworkOf(value, ctx)
  const vlanNet = isVlanNetwork(net) ? net : null
  const vlanNetworks = vlanNetworksOf(ctx)
  const vlanId = parseVlan(value.vlan)
  const vlanOutOfRange = vlanId !== null && (vlanId < 1 || vlanId > 4094)
  // Sama dengan aturan server (DEC-006/DEC-024); pesan lengkap tampil di ringkasan error tab.
  const prefixInvalid = value.prefix !== requiredPrefix(net)
  const gatewayInvalid = !isHostInSubnet(value.gateway, net.cidr)

  function addDns() {
    const v = dnsDraft.trim()
    if (!isIpv4(v) || value.dns.includes(v) || value.dns.length >= 4) return
    onChange({ dns: [...value.dns, v] })
    setDnsDraft("")
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Mode</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          value={value.mode}
          onValueChange={(v) => v && onChange({ mode: v as NetForm["mode"] })}
        >
          <ToggleGroupItem value="static" className="px-4">
            Static
          </ToggleGroupItem>
          <ToggleGroupItem value="dhcp" className="px-4">
            DHCP
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {value.mode === "dhcp"
            ? "Host memakai IP dinamis dari dnsmasq. IP bisa berubah antar boot."
            : vlanNet
              ? `IP management statis di VLAN ${vlanNet.vlan} pada NIC yang dipilih. Saat PXE, host tetap memakai IP dinamis dari dnsmasq.`
              : "IP management statis di NIC yang dipilih; dipakai juga sebagai reservasi DHCP saat PXE."}
        </FieldDescription>
      </Field>

      {value.mode === "static" && (
        <>
          {!bulk ? (
            <Field data-invalid={plan[0]?.error ? true : undefined}>
              <FieldLabel htmlFor="net-ip">IP address</FieldLabel>
              <Input
                id="net-ip"
                className="type-data"
                placeholder={defaultIpRange(net).start}
                value={value.ip}
                aria-invalid={plan[0]?.error ? true : undefined}
                onChange={(e) => onChange({ ip: e.target.value })}
              />
              {plan[0]?.error && value.ip ? (
                <FieldError>
                  <IpText text={plan[0].error} />
                </FieldError>
              ) : (
                <FieldDescription data-testid="net-ip-hint">
                  {vlanNet ? (
                    <>
                      Di dalam{" "}
                      <span className="type-data text-xs">{vlanNet.cidr}</span>{" "}
                      (VLAN {vlanNet.vlan}).
                    </>
                  ) : (
                    <>
                      Di dalam{" "}
                      <span className="type-data text-xs">{mgmt.cidr}</span>
                      , di luar range dinamis{" "}
                      <span className="type-data text-xs">
                        {lo}–{hi}
                      </span>
                      .
                    </>
                  )}
                </FieldDescription>
              )}
            </Field>
          ) : (
            <FieldSet>
              <FieldLegend variant="label">Alokasi IP</FieldLegend>
              <FieldGroup className="gap-4">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={value.planKind}
                  onValueChange={(v) =>
                    v && onChange({ planKind: v as NetForm["planKind"] })
                  }
                >
                  <ToggleGroupItem value="range" className="px-3">
                    Range IP
                  </ToggleGroupItem>
                  <ToggleGroupItem value="increment" className="px-3">
                    IP awal + increment
                  </ToggleGroupItem>
                </ToggleGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="net-start">IP awal</FieldLabel>
                    <Input
                      id="net-start"
                      className="type-data"
                      value={value.start}
                      onChange={(e) => onChange({ start: e.target.value })}
                    />
                  </Field>
                  {value.planKind === "range" ? (
                    <Field>
                      <FieldLabel htmlFor="net-end">IP akhir</FieldLabel>
                      <Input
                        id="net-end"
                        className="type-data"
                        value={value.end}
                        onChange={(e) => onChange({ end: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="net-step">Increment</FieldLabel>
                      <Input
                        id="net-step"
                        type="number"
                        min={1}
                        max={64}
                        className="type-data"
                        value={value.step}
                        onChange={(e) =>
                          onChange({
                            step: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                    </Field>
                  )}
                </div>
                <Field orientation="horizontal">
                  <Checkbox
                    id="net-skip"
                    checked={value.skipUsed}
                    onCheckedChange={(v) => onChange({ skipUsed: v === true })}
                  />
                  <FieldLabel htmlFor="net-skip" className="font-normal">
                    {vlanNet
                      ? "Lewati IP yang sudah dipakai host lain atau lease aktif"
                      : "Lewati IP yang sudah dipakai host lain, lease aktif, atau range dinamis"}
                  </FieldLabel>
                </Field>
                <PlanTable
                  hosts={ctx.hosts}
                  rows={plan.map((r) => ({
                    hostId: r.hostId,
                    value: r.ip,
                    error: r.error,
                  }))}
                  valueLabel="IP baru"
                  currentOf={(h) => h.mgmtIp ?? h.currentIp}
                />
              </FieldGroup>
            </FieldSet>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={prefixInvalid || undefined}>
              <FieldLabel htmlFor="net-prefix">Prefix</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <span className="type-data">/</span>
                </InputGroupAddon>
                <InputGroupInput
                  id="net-prefix"
                  type="number"
                  min={8}
                  max={30}
                  className="type-data"
                  aria-invalid={prefixInvalid || undefined}
                  value={value.prefix}
                  onChange={(e) =>
                    onChange({ prefix: Number(e.target.value) || 24 })
                  }
                />
              </InputGroup>
            </Field>
            <Field data-invalid={gatewayInvalid || undefined}>
              <FieldLabel htmlFor="net-gw">Gateway</FieldLabel>
              <Input
                id="net-gw"
                className="type-data"
                value={value.gateway}
                aria-invalid={gatewayInvalid || undefined}
                onChange={(e) => onChange({ gateway: e.target.value })}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="net-dns">DNS server</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {value.dns.map((d) => (
                <Badge
                  key={d}
                  variant="outline"
                  className="type-data h-7 gap-1 overflow-visible bg-card pr-1"
                >
                  {d}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    // Area klik 38px (padding box 22 + 2×8) tanpa membesarkan badge; badge overflow-visible agar
                    // pseudo-element tidak terpotong (DR-3-3/DR-3-4).
                    className="relative after:absolute after:-inset-2 after:content-['']"
                    aria-label={`Hapus DNS ${d}`}
                    onClick={() =>
                      onChange({ dns: value.dns.filter((x) => x !== d) })
                    }
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </Badge>
              ))}
            </div>
            <InputGroup>
              <InputGroupInput
                id="net-dns"
                className="type-data"
                placeholder="1.1.1.1"
                value={dnsDraft}
                onChange={(e) => setDnsDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addDns()
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="xs"
                  className="h-9 px-3"
                  disabled={!isIpv4(dnsDraft.trim()) || value.dns.length >= 4}
                  onClick={addDns}
                >
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    strokeWidth={2}
                    data-icon="inline-start"
                  />
                  Tambah
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              Maksimal 4. Tekan Enter untuk menambah.
            </FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={vlanOutOfRange || undefined}>
              <FieldLabel htmlFor="net-vlan">VLAN ID (opsional)</FieldLabel>
              <Input
                id="net-vlan"
                inputMode="numeric"
                className="type-data"
                placeholder="tanpa VLAN"
                value={value.vlan}
                aria-invalid={vlanOutOfRange || undefined}
                onChange={(e) =>
                  onChange(
                    vlanPatch(value, e.target.value.replace(/\D/g, ""), ctx),
                  )
                }
              />
              {vlanOutOfRange ? (
                <FieldError>VLAN ID 1–4094</FieldError>
              ) : (
                <VlanHint
                  vlanId={vlanId}
                  registered={vlanNet !== null}
                  vlanNetworks={vlanNetworks}
                  mgmtCidr={mgmt.cidr}
                />
              )}
            </Field>
            <Field>
              <FieldLabel>Interface</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                value={value.ifaceBy}
                onValueChange={(v) =>
                  v && onChange({ ifaceBy: v as NetForm["ifaceBy"] })
                }
              >
                <ToggleGroupItem value="mac" className="px-3">
                  By MAC
                </ToggleGroupItem>
                <ToggleGroupItem value="name" className="px-3">
                  By nama
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </div>
          {value.ifaceBy === "name" ? (
            <Field>
              <FieldLabel htmlFor="net-iface">Nama interface</FieldLabel>
              <Input
                id="net-iface"
                className="type-data"
                placeholder="eno1"
                value={value.ifaceName}
                onChange={(e) => onChange({ ifaceName: e.target.value })}
              />
              <FieldDescription>
                Harus sama di semua host yang dikonfigurasi.
              </FieldDescription>
            </Field>
          ) : (
            <FieldDescription>
              NIC dipilih dari MAC PXE masing-masing host (
              <span className="type-data text-xs">match: macaddress</span>). NIC
              lain dibiarkan tanpa konfigurasi untuk automation berikutnya.
            </FieldDescription>
          )}
        </>
      )}
    </FieldGroup>
  )
}

/**
 * Petunjuk field VLAN (M7 §2.5c): daftar VLAN management terdaftar (`PXE_VLAN_NETWORKS`, mono) dan,
 * bila VLAN yang diketik tidak terdaftar, penjelasan bahwa aturan subnet PXE (DEC-006) yang berlaku.
 * Teks penjelasan memakai warna teks utama (informasi penting, DEC-017 §9).
 */
function VlanHint({
  vlanId,
  registered,
  vlanNetworks,
  mgmtCidr,
}: {
  vlanId: number | null
  registered: boolean
  vlanNetworks: readonly { vlan: number; cidr: string }[]
  mgmtCidr: string
}) {
  const unregistered = vlanId !== null && !registered
  if (!vlanNetworks.length && !unregistered) return null
  return (
    <>
      {vlanNetworks.length > 0 && (
        <FieldDescription data-testid="vlan-registered">
          Terdaftar:{" "}
          {vlanNetworks.map((v, i) => (
            <React.Fragment key={v.vlan}>
              {i > 0 && ", "}
              <span
                data-slot="vlan-hint"
                className="type-data text-xs whitespace-nowrap"
              >
                {v.vlan} · {v.cidr}
              </span>
            </React.Fragment>
          ))}
        </FieldDescription>
      )}
      {unregistered && (
        <FieldDescription
          data-testid="vlan-unregistered"
          className="text-foreground"
        >
          VLAN {vlanId} tidak terdaftar di{" "}
          <span className="type-data text-xs">PXE_VLAN_NETWORKS</span>; IP,
          prefix, dan gateway mengikuti subnet PXE{" "}
          <span className="type-data text-xs">{mgmtCidr}</span>.
        </FieldDescription>
      )}
    </>
  )
}
