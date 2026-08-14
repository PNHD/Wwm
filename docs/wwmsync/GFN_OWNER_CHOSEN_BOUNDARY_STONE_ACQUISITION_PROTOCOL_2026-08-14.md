# WWMSync — Owner-Chosen Boundary-Stone Acquisition Protocol Amendment

Date: 2026-08-14

Status: **FROZEN PRE-OWNER-RECORDING**

Verified pre-amendment HEAD:

`813f99eef1de20fb514fc5899a9c37762cff72da`

## 1. Scope of supersession

This amendment supersedes **only the acquisition manifest/order and owner recording instructions** from:

- `docs/wwmsync/GFN_KNOWN_LOCATION_CONTROL_SET_2026-08-14.md`
- the legacy `frozenAcquisitionOrder` / recording-protocol fields in `docs/wwmsync/gfn-known-location-control-set.json`

The prior morphology-optimized six-location design is now:

**SUPERSEDED FOR ACQUISITION**

It is **not deleted, rewritten, or invalidated as provenance**. Its candidate-pool analysis, morphology descriptors, selected point identities, GT/catalog lineage, source digests, diversity measurements, and preregistration history remain preserved exactly as historical evidence of the earlier design.

The six previously named locations are no longer required owner acquisition targets and must not be used as an advance target list for this recording. If one is encountered incidentally through the owner-chosen process, that does not retroactively make the old manifest active.

No matcher result was used to choose this replacement acquisition protocol.

## 2. Guardrails preserved

This is a protocol-only amendment.

- Do **not** run matcher experiments before or while choosing the six controls.
- Do **not** modify production matcher architecture.
- Do **not** modify matcher cache behavior.
- Do **not** modify preprocessing.
- Production structural gate remains **`0.58`**.
- `vision-sync.js`, `dashen-tile-cache.js`, and `tools/build_dashen_visual_cache.py` are outside this amendment scope.
- Do not derive location identity or GT from HUD matcher output.

## 3. Active acquisition protocol

Protocol name:

**OWNER-CHOSEN BOUNDARY-STONE CONTROL SET**

The owner records the **first six distinct Boundary Stones they choose during one GFN session, before seeing any matcher result**.

Selection guidance:

- Prefer **3 Qinghe** and **3 Kaifeng**.
- Prefer visibly separated areas rather than nearby stones.
- Do **not** use East Cross Street.
- Do **not** use General's Shrine.
- Do **not** use Fang Xu.
- The owner does **not** need to know Boundary Stone names in advance.
- Do not consult the superseded morphology-optimized six-location list as a targeting guide.

The owner may navigate the map normally and choose practical Boundary Stones. The choice must remain independent of any later HUD matcher result.

## 4. One continuous original GFN recording

Use **one continuous original GFN recording** covering all six controls.

At each selected Boundary Stone:

1. Open the world map.
2. Click/select a Boundary Stone.
3. Keep the selected map state visible for **2–3 seconds** so the displayed name, selected marker position, and surrounding map context are recorded.
4. Teleport.
5. Close the map.
6. Do **not** move.
7. Wait for the minimap/HUD to settle.
8. Remain stationary for **2–3 seconds**.
9. Continue to the next distinct Boundary Stone.

Repeat until six distinct owner-chosen controls have been recorded.

## 5. Identity and GT resolution — mandatory order

After acquisition, each control's identity and GT must be resolved from its **map-selection frame before examining that control's HUD matcher outcome**.

Use the following evidence, in order and in combination as needed:

1. displayed teleport name;
2. region;
3. selected screen/map position;
4. nearby labels and landmarks;
5. existing first-party / Dashen catalog lineage.

If a displayed name is duplicated, disambiguate using the selected map position and surrounding map context.

The resolved identity/GT record must be frozen before the corresponding HUD matcher result is inspected.

**HUD matching must never be used to derive, choose, adjust, or disambiguate GT.**

## 6. Anti-selection-bias rule

The six controls are defined by owner choice and recording order, not by matcher performance.

Once the owner has selected and recorded a distinct Boundary Stone, it remains part of the control set even if its later matcher outcome is inconvenient, ambiguous, or failing. A location may not be swapped after matcher inspection to improve the observed result distribution.

## 7. Relationship to the superseded six-location design

The earlier six named morphology-optimized controls remain useful only as provenance for the prior pre-acquisition design and its morphology-analysis methodology.

For the new owner recording:

- there is no frozen named six-location target list;
- there is no required order of named stones;
- there is no requirement to search for a teleport by name;
- acquisition identity is established from the recorded map-selection state after capture, before HUD matching;
- the active sample is the first six distinct valid owner-chosen Boundary Stones satisfying this protocol.

## 8. Freeze condition

This protocol is frozen **before owner recording**.

Any later change to location eligibility, selection procedure, capture timing, GT-resolution procedure, or matcher-independent ordering must be recorded as a new explicit protocol amendment before additional acquisition. Later HUD outcomes cannot silently alter this protocol.

Production matcher/cache/preprocessing remain untouched by this amendment, and the structural gate remains `0.58`.
