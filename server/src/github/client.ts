import { Octokit } from '@octokit/rest';
import { graphql as createGraphql } from '@octokit/graphql';

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN env variable not set');

export const octokit = new Octokit({
  auth: token,
  userAgent: 'GitPulse/1.0',
});

export const graphql = createGraphql.defaults({
  headers: {
    authorization: `token ${token}`,
    'user-agent': 'GitPulse/1.0',
  },
});

export const USERNAME = process.env.GITHUB_USERNAME || 'MoshikEilon';
