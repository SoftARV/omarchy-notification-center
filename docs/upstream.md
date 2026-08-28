# Taking an upstream release

The `upstream` branch carries pristine snapshots of
`/usr/share/omarchy/shell/plugins/notifications` and nothing else — no fork
edits ever land on it. That gives a real three-way base, so picking up an
omarchy release is a merge rather than a re-application by hand.

Its root commit is a reconstruction of the fork point; see that commit message
for what pins each file. Every commit after it is a verbatim vendor drop.

## The procedure

```sh
git checkout upstream
cp -r /usr/share/omarchy/shell/plugins/notifications/. .
git commit -am "Vendor omarchy.notifications from omarchy <version>"

git checkout main
git merge upstream
./scripts/check-delta.sh
```

`check-delta.sh` is the last step for a reason: a merge can resolve cleanly and
still have moved fork code somewhere it does not belong, or left an upstream
file no longer byte-identical.

## What check-delta.sh enforces

1. `NotificationLogic.js` and `components/NotificationCard.qml` are byte-identical to `upstream`.
2. `Service.qml` adds no more than 60 lines over upstream.
3. Every changed hunk in `Service.qml` begins with a `// fork:` marker.
4. Every marker names a spec file that exists in `docs/spec/`.

It exits 0 with a note when there is no `upstream` branch, so a fresh clone does
not look like a failure. Full reasoning and the hook inventory:
[spec/SPEC-fork-seam.md](spec/SPEC-fork-seam.md).

## Lint

```sh
/usr/lib/qt6/bin/qmllint Service.qml
```

`qmllint` cannot resolve the `qs.*` imports outside the shell, so it reports
unqualified-access and uncreatable-type warnings on upstream's own files too —
about 32 of them. Compare against upstream rather than expecting silence:

```sh
diff <(/usr/lib/qt6/bin/qmllint /usr/share/omarchy/shell/plugins/notifications/Service.qml 2>&1 | grep -oE '\[[a-z-]+\]' | sort | uniq -c) \
     <(/usr/lib/qt6/bin/qmllint Service.qml 2>&1 | grep -oE '\[[a-z-]+\]' | sort | uniq -c)
```

This comparison is deliberately not scripted — see the open questions in
[../tasks/fork-seam/plan.md](../tasks/fork-seam/plan.md).
