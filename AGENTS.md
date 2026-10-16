# terminology-sdk-front-ts

- Use red-green-refactor TDD and sequential tests.
- Consume exact released terminology data/core packages; never commit local dependencies.
- Verify size and SHA-256 before atomically replacing a cached snapshot.
- Browser requests use same-origin credentials only and never contain an upstream service token.
- Preserve grouped `data[]` entries and plain `code -> value` attributes.
- Framework components belong in separate packages.
