# Show HN post (draft — not published)

**Title:** Show HN: Marble Love – a function-by-function TypeScript reimplementation of Marble Madness

**URL:** https://github.com/magno73/marble-love

---

Marble Love is a from-scratch reimplementation of Atari's *Marble Madness*
(1984) in TypeScript. It is not an emulator: each routine of the 68010 program
is ported function by function from the disassembly into readable code, then
checked against MAME byte for byte as a behavioral oracle.

Three things that might be worth your time:

- **A real finding fell out of the byte diffs.** A 126-byte playfield mismatch
  at one frame traced to the cartridge's slapstic security chip observing the
  68010's *instruction prefetch* outside its protected ROM window — a side
  channel I couldn't find in the MAME source or any datasheet. Write-up:
  docs/findings/slapstic-prefetch-side-channel.md, and a longer article in
  docs/articles/.
- **The claims are checkable.** docs/STATUS.md is a parity matrix: per
  subsystem, whether it is bit-perfect, behavioral, or heuristic, with an exact
  command to verify each. Where I wasn't sure, the row is left out.
- **It is honest about what it is not.** Source-level, not cycle-accurate; audio
  is recognizable, not sample-exact; known gaps are listed, not hidden.

It runs in the browser (PixiJS) but ships no game assets — you supply your own
legally dumped ROMs.

An LLM agent was in the loop for a lot of the grind. That is a tool, not the
pitch; the oracle and the tests are what make it trustworthy. Happy to go into
the differential-debugging workflow in the comments.

---

*(Word count target < 300; the three points map to the finding, STATUS.md, and
the honesty section of the repo.)*
