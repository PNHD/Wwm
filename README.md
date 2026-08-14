# WWMSync

WWMSync is a fan-made **Where Winds Meet** map companion focused on trustworthy map data, location tracking experiments, and evidence-driven validation.

The repository contains multiple development lines. The default `main` branch is intentionally lightweight; production and experimental work live on dedicated branches so research can be validated without silently changing the deployed product.

## Repository map

- `production/wwsync` — production-safe web map.
- `feature/wwm-native-sync-v2` — active R&D for local capture, visual localization, replay diagnostics, and native sync experiments.
- `production/wwm-atlas` — atlas-related production work.
- `.github/workflows` — reproducible replay, fixture, audit, and validation workflows used during development.

## Engineering approach

WWMSync treats experimental evidence separately from production acceptance. A candidate implementation is not considered successful simply because it builds or produces plausible coordinates.

Validation work includes:

- deterministic fixture/replay testing;
- structural and image-matching diagnostics;
- known-location positive and negative controls;
- explicit production gates rather than score inflation;
- CI artifacts retained for audit and regression comparison;
- clear separation between public map data, experimental local processing, and unavailable private game-side transports.

## Safety boundary

The project does not attempt to steal credentials, bypass account authentication, defeat anti-cheat, or claim unsupported server-side integration. Experimental sync work is constrained to locally available signals and reproducible evidence.

## Status

WWMSync is under active development. Production behavior and experimental branches intentionally move at different speeds; check the relevant branch and its CI evidence before treating a result as accepted.

Fan-made project. Not affiliated with NetEase Games or the Where Winds Meet development team.
