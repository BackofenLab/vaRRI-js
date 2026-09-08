const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

function releaseMetadata(tag, prerelease = false) {
  // Validate before invoking npm; accept SemVer with an optional v prefix.
  const version = String(tag ?? '').replace(/^v/, '');
  const numeric = '(?:0|[1-9][0-9]*)';
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
  if (!semver.test(version)) throw new Error(`Release tag must be a semantic version: ${tag}`);
  return { version, npmTag: prerelease || version.split('+')[0].includes('-') ? 'next' : 'latest' };
}

if (require.main === module) {
  const { version, npmTag } = releaseMetadata(process.env.RELEASE_TAG, process.env.IS_PRERELEASE === 'true');
  execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], { stdio: 'inherit' });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `npm_tag=${npmTag}\n`);
  console.log(`Release ${version} will publish to npm tag ${npmTag}`);
}

module.exports = { releaseMetadata };
