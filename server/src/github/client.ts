import { Octokit } from '@octokit/rest';

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN env variable not set');

export const octokit = new Octokit({
  auth: token,
  userAgent: 'GitPulse/1.0',
});

export const USERNAME = process.env.GITHUB_USERNAME || 'MoshikEilon';
