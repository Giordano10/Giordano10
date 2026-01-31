import fs from "fs/promises";

const README_PATH = "README.md";
const USERNAME = "Giordano10";
const TOKEN = process.env.GH_READ_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}

const query = `
  query($login: String!, $first: Int!, $after: String, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        commitContributionsByRepository {
          repository { nameWithOwner url }
          contributions { totalCount }
        }
        issueContributionsByRepository {
          repository { nameWithOwner url }
          contributions { totalCount }
        }
        pullRequestContributionsByRepository {
          repository { nameWithOwner url }
          contributions { totalCount }
        }
        pullRequestReviewContributionsByRepository {
          repository { nameWithOwner url }
          contributions { totalCount }
        }
      }
      repositoriesContributedTo(
        first: $first
        after: $after
        contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REVIEW]
        includeUserRepositories: true
      ) {
        nodes { nameWithOwner url }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

async function fetchContributedRepos() {
  const repos = [];
  let hasNextPage = true;
  let after = null;
  

  const from = new Date("2016-01-01T00:00:00Z").toISOString();
  const to = new Date().toISOString();

  while (hasNextPage) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          login: USERNAME,
          first: 50,
          after,
          from,
          to,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    const user = data?.data?.user;
    const contributed = user?.repositoriesContributedTo;
    const collection = user?.contributionsCollection;


    if (collection) {
      const groups = [
        collection.commitContributionsByRepository,
        collection.issueContributionsByRepository,
        collection.pullRequestContributionsByRepository,
        collection.pullRequestReviewContributionsByRepository,
      ];

      for (const group of groups) {
        for (const entry of group || []) {
          if (entry?.contributions?.totalCount > 0) {
            repos.push(entry.repository);
          }
        }
      }
    }

    if (!contributed) {
      break;
    }

    repos.push(...contributed.nodes);
    hasNextPage = contributed.pageInfo.hasNextPage;
    after = contributed.pageInfo.endCursor;
  }

  const restRepos = await fetchRecentReposFromRest();
  repos.push(...restRepos);

  const unique = new Map();
  for (const repo of repos) {
    unique.set(repo.nameWithOwner, repo.url);
  }

  return Array.from(unique.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, url]) => ({ name, url }));
}


async function fetchRecentReposFromRest() {
  const allowedEvents = new Set([
    "PushEvent",
    "PullRequestEvent",
    "IssuesEvent",
    "IssueCommentEvent",
    "PullRequestReviewEvent",
    "PullRequestReviewCommentEvent",
  ]);

  const repos = [];
  const headers = {
    "Content-Type": "application/json",
    Authorization: `bearer ${TOKEN}`,
  };

  for (let page = 1; page <= 3; page += 1) {
    const response = await fetch(
      `https://api.github.com/users/${USERNAME}/events/public?per_page=100&page=${page}`,
      { headers }
    );

    if (!response.ok) {
      break;
    }

    const events = await response.json();
    if (!Array.isArray(events) || events.length === 0) {
      break;
    }

    for (const event of events) {
      if (!allowedEvents.has(event?.type)) {
        continue;
      }

      const repoName = event?.repo?.name;
      if (repoName) {
        repos.push({
          nameWithOwner: repoName,
          url: `https://github.com/${repoName}`,
        });
      }
    }
  }

  return repos;
}

function renderList(repos) {
  if (!repos.length) {
    return "- _No public contributions found._";
  }

  return repos.map((repo) => `- [${repo.name}](${repo.url})`).join("\n");
}

async function updateReadme() {
  const readme = await fs.readFile(README_PATH, "utf8");
  const start = "<!-- CONTRIBUTED-REPOS:START -->";
  const end = "<!-- CONTRIBUTED-REPOS:END -->";

  if (!readme.includes(start) || !readme.includes(end)) {
    throw new Error("README markers not found for contributed repos");
  }

  const repos = await fetchContributedRepos();
  const list = renderList(repos);

  const updated = readme.replace(
    new RegExp(`${start}[\\s\\S]*?${end}`, "m"),
    `${start}\n${list}\n${end}`
  );
  await fs.writeFile(README_PATH, updated, "utf8");
}

updateReadme().catch((error) => {
  console.error(error);
  process.exit(1);
});
