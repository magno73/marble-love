process.env.REPLAY_PROBE_DEFAULT_INPUT ??= "oracle/scenarios/input/playable_coin_start.json";
process.env.REPLAY_PROBE_LABEL ??= "Playable replay";

await import("./probe-demo-replay.js");

export {};
