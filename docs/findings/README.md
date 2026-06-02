# Findings

These notes capture significant technical findings from the bit-faithful
reimplementation work. Each document should describe a non-obvious hardware or
software behavior discovered through differential debugging, with links to the
relevant evidence, tests, and commits.

The findings are written as public technical material for future blog posts,
Hacker News discussions, or post-launch writeups.

## Findings Index

- [Slapstic FSM observes 68010 CPU prefetch outside protected window](slapstic-prefetch-side-channel.md)
  - 2026-05-13. Hardware quirk in the slapstic 137412-103 chip. CPU prefetch
    outside the protected range can arm the FSM when it matches the `alt1`
    pattern. Impact: closed a 126-byte playfield diff at f12950.
- [The Silly Race inverts the trackball with a single add/subtract flip](silly-race-inverted-trackball.md)
  - 2026-06-02. The trackball-apply routine (`FUN_00025DF6`) adds the delta on
    game mode 4 (the Silly Race) where every other level subtracts it, inverting
    the marble's response. A decades-old gameplay gimmick reduced to one branch.
- [Level descriptor header format](../level-header-format.md)
  - 2026-05-19. Byte-level layout of the six Marble Madness level descriptors,
    with M68010 consumers, MAME taps, parity artifacts, and verified unknowns.

## Adding Findings

When you discover a non-obvious behavior, create
`docs/findings/<topic>-<short-desc>.md` with:

1. TL;DR
2. Background
3. Anomaly
4. Discovery
5. Fix
6. Verification
7. Reflections
8. References
9. Commits

Then add the note to this index and link it from a relevant public or internal
status document when needed.
