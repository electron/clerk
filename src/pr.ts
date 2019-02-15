import { Context } from 'probot';
import { WebhookPayloadWithRepository } from 'probot/lib/context';
import * as semver from 'semver';

export function getTargetVersions(version: string): string[] {
  const prerelease = semver.prerelease(version);
  const [release] = version.split('-');
  return prerelease
    ? prerelease[0] === 'nightly'
      ? [`${release}-beta.1`, release]
      : [semver.inc(version, 'prerelease'), release]
    : [semver.inc(version, 'patch')];
}

async function getPackageJsonForRef(context: Context, ref: string) {
  const packageJsonResp = await context.github.repos.getContent(context.repo({
    ref,
    path: 'package.json',
  }));
  return JSON.parse(Buffer.from(packageJsonResp.data.content, 'base64').toString('utf8'));
}

export async function getTargetVersionsForPr(
  context: Context,
  pr: WebhookPayloadWithRepository['pull_request'],
): Promise<string[]> {
  const packageJson = await getPackageJsonForRef(context, pr.head.sha);
  const version = semver.valid(packageJson.version);
  if (!version) {
    throw new Error(`Couldn't find version in package.json. ` +
      `Expected valid semver string but found '${packageJson.version}'.`);
  }
  return getTargetVersions(version);
}
