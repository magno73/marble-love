# Gameplay drift byte map @ f+99

Totale: **0 byte gameplay** (di cui 172B stack residue esclusi da invariante).

Generato da `packages/cli/src/probe-gameplay-byte-map.ts`.

## Top-10 bottleneck "early diverge"

I byte che divergono prima sono i candidati root cascade. Una volta fixati questi, molti downstream collassano.

| offset | TS | MAME | first_diverge | field | candidate writer |
|---|---|---|---|---|---|

## Cluster ranking (by byte count)

| rank | cluster | bytes | cum | %tot | earliest diverge | dominant writer |
|---|---|---:|---:|---:|---|---|

## Per-cluster detail
