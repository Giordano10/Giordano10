import fs from "fs/promises";

const README_PATH = "README.md";
const USERNAME = "Giordano10";
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}

const query = `
  query($login: String!, $first: Int!, $after: String) {
    user(login: $login) {
      repositoriesContributedTo(
        first: $first
        after: $after
        contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REVIEW]
        includeUserRepositories: false
      ) {
        nodes {
          nameWithOwner
          url
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

async function fetchContributedRepos() {
  const repos = [];
  let hasNextPage = true;
  let after = null;

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
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    const result = data?.data?.user?.repositoriesContributedTo;

    if (!result) {
      break;
    }

    repos.push(...result.nodes);
    hasNextPage = result.pageInfo.hasNextPage;
    after = result.pageInfo.endCursor;
  }

  const unique = new Map();
  for (const repo of repos) {
    unique.set(repo.nameWithOwner, repo.url);
  }

  return Array.from(unique.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, url]) => ({ name, url }));
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
    throw new Error("README markers not found");
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
