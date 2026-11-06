# Security policy

## Supported versions

Only the latest 0.x release receives security fixes. Access Control is distributed through GitHub
releases and is not published to npm.

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Kevinjohn/oss-adonisjs-access-control/security/advisories)
or email [cve@kevinjohngallagher.com](mailto:cve@kevinjohngallagher.com). Never open a public issue.

Include the affected package version or commit, runtime and database versions, a concise
reproduction, and the impact you observed. Do not include live credentials or personal data.

## Verifying a release

The release notes include the SHA-256 digest for the attached tarball. Check a downloaded archive
against that digest before installing it:

```sh
shasum -a 256 kevinjohn-adonisjs-access-control-<version>.tgz
```

## Security model

The [build specification](https://github.com/Kevinjohn/oss-adonisjs-access-control/blob/main/docs/maintainers/design/spec-access-control.md)
describes what the package enforces (membership rules, lock order, owner invariants) and what
remains the application's responsibility (authentication, record-level rules, team CRUD).

## Dependency assessment

See the dated [dependency audit assessment](https://github.com/Kevinjohn/oss-adonisjs-access-control/blob/main/docs/maintainers/verification.md#dependency-audit-assessment)
for graph scope, retained advisories and follow-up boundaries.

## Independent review

None yet.
