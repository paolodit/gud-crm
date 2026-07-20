# Public repository release

The public repository is the generic GUD application only. Private instances remain separate databases and deployments of that application.

## Before changing repository visibility

1. Keep the GitHub repository private while preparing the release.
2. Run `npm run privacy:audit`, the security audit and the complete test suite against the release commit.
3. Confirm the release tree contains only fictional `DEMO ·` records and placeholder identities.
4. Confirm databases, spreadsheets, exports, uploads, local instance registries and environment files are ignored and absent from the Git index.
5. Publish from a clean history that never contained operating fixtures. Removing a file from the latest commit is not enough because earlier Git commits remain downloadable.
6. Review GitHub Actions logs, releases, issue attachments and pull-request diffs for private data.
7. Enable GitHub secret scanning and dependency alerts before changing visibility.
8. Rotate any credential that may ever have appeared in a commit or CI log.

## History-cleaning record

The repository owner approved replacing the development history with one audited root commit before publication. The previous private history is retained only in an ignored local Git bundle for disaster recovery; that bundle must be treated as private operating data and must never be pushed or attached to an issue or release.

GitHub pull-request refs and cached commit views can survive a normal force-push. Keep the repository private until those internal references have been archived and either GitHub Support has confirmed purging them or the private repository has been safely recreated from the clean root. Normal pull-request development can continue after that final hosting check.
