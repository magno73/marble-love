# Third-Party Software And References

This project combines original source code with open-source tools and public
technical references. It does not distribute Marble Madness ROM data.

## Runtime And Development Dependencies

- TypeScript
- Vite
- PixiJS
- fflate
- Vitest
- ESLint and typescript-eslint
- pngjs
- musashi-wasm

See `package.json` and package-level manifests for exact versions.

## Reverse-Engineering References And Tools

- MAME is used as the behavioral oracle for runtime traces, ROM layout, video
  hardware references, and sound command/audio investigations.
- Ghidra is used for static analysis of the original program ROM.
- Tom Harte 68000-family CPU test fixtures may be used for CPU-level validation
  where retained in this repository.

## ROM And Game Asset Notice

The Marble Love source code is MIT licensed. Marble Madness ROM data, graphics,
audio, trademarks, and other original game assets remain the property of their
respective rights holders and are not licensed by this repository.

Users must provide their own legally obtained ROM dumps. No ROM files are
included, and the browser loader reads local ZIP files only.
