/** Water status ladder (CONTRACT §E.11) and zone peer comparison (§E.9). Values and readings come from the service. */
import clsx from 'clsx';
import { Activity, CloudRain, Droplets, Leaf, Mountain, Users } from 'lucide-react';
import type { PeerComparison, WaterStatus } from '@/domain/types';
import { signed } from '@/shared/format';
import { Card, DataAsOf, ProvenanceBadge } from '@/shared/ui';
import { PEER_READING, Z_MAX, Z_MIN, waterRungs, zPosition, type Rung } from './farmData';
import { TONE_BG, TONE_TEXT, ToneIcon } from './parts';

const RUNG_ICON: Record<Rung['key'], typeof Droplets> = {
  irrigated: Droplets,
  demand: CloudRain,
  supply: Mountain,
  stress: Activity,
  abandonment: Leaf,
};

export function WaterLadderCard({ water, supplyAsOf }: { water: WaterStatus; supplyAsOf?: string | null }) {
  const rungs = waterRungs(water);
  return (
    <Card title="Water status" subtitle="Five questions, in order. Each answer shows its source." actions={<DataAsOf value={supplyAsOf} label="Water supply" />}>
      <ol className="relative space-y-3">
        {rungs.map((r, i) => {
          const Icon = RUNG_ICON[r.key];
          return (
            <li key={r.key} className="relative flex gap-3">
              <div className="flex flex-col items-center">
                <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TONE_BG[r.tone], TONE_TEXT[r.tone])}>
                  <Icon size={16} />
                </span>
                {i < rungs.length - 1 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs tabular-nums text-muted">{r.step}</span>
                  <span className="text-sm font-medium text-ink">{r.question}</span>
                  <ProvenanceBadge provenance={r.provenance} title={r.question} />
                </div>
                <p className={clsx('mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium', TONE_TEXT[r.tone])}>
                  <ToneIcon tone={r.tone} size={16} />
                  {r.status}
                </p>
                {r.facts.length > 0 && (
                  <dl className="mt-1 grid grid-cols-[minmax(0,1fr),auto] gap-x-3 gap-y-0.5 text-sm">
                    {r.facts.map((f) => (
                      <div key={f.label} className="contents">
                        <dt className="text-muted">{f.label}</dt>
                        <dd className="text-right tabular-nums text-ink">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {r.evidence && <p className="mt-1 text-sm text-muted">{r.evidence}</p>}
                {r.provenance.note && !r.evidence && r.facts.length > 0 && <p className="mt-1 text-xs text-muted">{r.provenance.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function ZScale({ rows }: { rows: { label: string; farm: number | null | undefined; peers: number | null | undefined }[] }) {
  const ticks = [-3, -2, -1, 0, 1, 2];
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-ink">{r.label}</span>
            <span className="tabular-nums text-muted">
              farm {r.farm === null || r.farm === undefined ? '–' : `${signed(r.farm, 1, { plus: true })} sd`} · peers {r.peers === null || r.peers === undefined ? '–' : `${signed(r.peers, 1, { plus: true })} sd`}
            </span>
          </div>
          <div className="relative mt-2 h-6">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface" />
            <div className="absolute top-1/2 h-1 -translate-y-1/2 bg-warn-soft" style={{ left: 0, width: `${zPosition(-1) * 100}%` }} />
            {ticks.map((t) => (
              <span key={t} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line" style={{ left: `${zPosition(t) * 100}%` }} />
            ))}
            {r.peers !== null && r.peers !== undefined && (
              <span
                title={`Peer median ${signed(r.peers, 1)} sd`}
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-muted"
                style={{ left: `${zPosition(r.peers) * 100}%` }}
              />
            )}
            {r.farm !== null && r.farm !== undefined && (
              <span
                title={`This farm ${signed(r.farm, 1)} sd`}
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand"
                style={{ left: `${zPosition(r.farm) * 100}%` }}
              />
            )}
          </div>
          <div className="relative mt-0.5 h-4 text-[11px] tabular-nums text-muted">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${zPosition(t) * 100}%` }}>
                {signed(t, 0, { plus: true })}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PeersCard({ peers }: { peers: PeerComparison }) {
  const reading = PEER_READING[peers.reading];
  return (
    <Card
      title="Farm vs zone peers"
      subtitle={`${peers.nPeers} same-crop CIREN ${peers.nPeers === 1 ? 'orchard' : 'orchards'} in the 35 km² zone.`}
    >
      {/* Provenance in the body, not the header: the long source label squeezed the title. */}
      <div className="mb-3">
        <ProvenanceBadge provenance={peers.provenance} title="Peer comparison" />
      </div>
      <div className={clsx('flex items-start gap-2.5 rounded-card px-3 py-2', TONE_BG[reading.tone])}>
        <Users size={16} className={clsx('mt-0.5 shrink-0', TONE_TEXT[reading.tone])} />
        <div>
          <p className={clsx('text-sm font-medium', TONE_TEXT[reading.tone])}>{reading.title}</p>
          <p className="text-sm text-ink">{reading.text}</p>
        </div>
      </div>
      <div className="mt-4">
        <ZScale
          rows={[
            { label: 'Vigour (NDVI) vs own normal', farm: peers.farmNdviZ, peers: peers.peerMedianNdviZ },
            { label: 'Canopy moisture (NDMI) vs own normal', farm: peers.farmNdmiZ, peers: peers.peerMedianNdmiZ },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-brand" /> This farm
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-muted" /> Peer median
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm bg-warn-soft" /> Below −1 sd
          </span>
          <span className="text-muted">
            Scale {Z_MIN} to +{Z_MAX} sd. Context only: the peer reading does not change the score in v1.
          </span>
        </div>
      </div>
    </Card>
  );
}
