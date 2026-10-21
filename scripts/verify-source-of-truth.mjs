import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const options = new Set(process.argv.slice(2));
const offline = options.has('--offline') || options.has('--no-fetch');
const failures = [];
const checks = [];

function git(args, cwd = repoRoot) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout.trimEnd(),
    stderr: result.stderr.trimEnd(),
  };
}

function record(condition, success, failure) {
  if (condition) {
    checks.push(success);
    return true;
  }

  failures.push(failure);
  return false;
}

function isAncestor(commit, branch) {
  return git(['merge-base', '--is-ancestor', commit, branch]).status === 0;
}

function parseWorktrees(output) {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const entry = {};
      for (const line of block.split(/\r?\n/)) {
        const separator = line.indexOf(' ');
        if (separator === -1) {
          entry[line] = true;
          continue;
        }
        entry[line.slice(0, separator)] = line.slice(separator + 1);
      }
      return entry;
    });
}

console.log(`Source-of-truth root: ${repoRoot}`);

if (!offline) {
  const fetched = git(['fetch', '--prune', 'origin']);
  record(
    fetched.status === 0,
    'Fetched origin with pruning.',
    `Could not fetch origin: ${fetched.stderr || fetched.stdout || 'unknown error'}`,
  );
} else {
  checks.push('Skipped fetch; comparing against the existing origin/main ref.');
}

const remoteUrl = git(['remote', 'get-url', 'origin']);
record(
  remoteUrl.status === 0,
  `Origin: ${remoteUrl.stdout}`,
  'Git remote "origin" is missing.',
);

const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
record(
  branch.status === 0 && branch.stdout === 'main',
  'Current branch is main.',
  `Final verification must run on main, not ${branch.stdout || 'a detached HEAD'}.`,
);

const worktreeOutput = git(['worktree', 'list', '--porcelain']);
if (worktreeOutput.status === 0) {
  const worktrees = parseWorktrees(worktreeOutput.stdout);
  checks.push(`Found ${worktrees.length} worktree(s).`);

  for (const worktree of worktrees) {
    const worktreePath = worktree.worktree;
    const status = git(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      worktreePath,
    );
    record(
      status.status === 0 && status.stdout === '',
      `Clean worktree: ${worktreePath}`,
      `Uncommitted changes in ${worktreePath}:\n${status.stdout || status.stderr}`,
    );

    if (worktree.HEAD) {
      record(
        isAncestor(worktree.HEAD, 'main'),
        `Worktree HEAD is contained in main: ${worktreePath}`,
        `Worktree HEAD is not merged into main: ${worktreePath} (${worktree.HEAD})`,
      );
    }
  }
} else {
  failures.push(`Could not list worktrees: ${worktreeOutput.stderr}`);
}

const stashes = git(['stash', 'list']);
record(
  stashes.status === 0 && stashes.stdout === '',
  'No Git stashes remain.',
  `Uncollected Git stash entries remain:\n${stashes.stdout || stashes.stderr}`,
);

const unmerged = git(['diff', '--name-only', '--diff-filter=U']);
record(
  unmerged.status === 0 && unmerged.stdout === '',
  'No unresolved merge entries.',
  `Unresolved merge entries:\n${unmerged.stdout || unmerged.stderr}`,
);

const localBranches = git([
  'for-each-ref',
  '--format=%(refname:short)',
  'refs/heads',
]);
if (localBranches.status === 0) {
  const unmergedBranches = localBranches.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => name !== 'main')
    .filter((name) => !isAncestor(name, 'main'));
  record(
    unmergedBranches.length === 0,
    'Every local branch is merged into main.',
    `Local branches contain unmerged commits: ${unmergedBranches.join(', ')}`,
  );
} else {
  failures.push(`Could not list local branches: ${localBranches.stderr}`);
}

const remoteBranches = git([
  'for-each-ref',
  '--format=%(refname:short)',
  'refs/remotes/origin',
]);
if (remoteBranches.status === 0) {
  const unmergedRemoteBranches = remoteBranches.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !['origin/HEAD', 'origin/main'].includes(name))
    .filter((name) => !isAncestor(name, 'main'));
  record(
    unmergedRemoteBranches.length === 0,
    'Every remote branch is merged into main.',
    `Remote branches contain unmerged commits: ${unmergedRemoteBranches.join(', ')}`,
  );
} else {
  failures.push(`Could not list remote branches: ${remoteBranches.stderr}`);
}

const localMain = git(['rev-parse', 'main']);
const trackedRemoteMain = git(['rev-parse', 'origin/main']);
if (
  record(
    localMain.status === 0 && trackedRemoteMain.status === 0,
    'Local main and origin/main both resolve.',
    'Could not resolve local main or origin/main.',
  )
) {
  record(
    localMain.stdout === trackedRemoteMain.stdout,
    `Local main matches origin/main at ${localMain.stdout}.`,
    `Local main and origin/main differ: ${localMain.stdout} != ${trackedRemoteMain.stdout}`,
  );
}

if (!offline) {
  const liveRemote = git([
    'ls-remote',
    'origin',
    'refs/heads/main',
  ]);
  const liveRemoteSha = liveRemote.stdout.split(/\s+/)[0] ?? '';
  record(
    liveRemote.status === 0 &&
      localMain.status === 0 &&
      liveRemoteSha === localMain.stdout,
    `Live GitHub main matches local main at ${liveRemoteSha}.`,
    `Live GitHub main does not match local main: ${liveRemoteSha || 'unavailable'} != ${localMain.stdout || 'unavailable'}`,
  );
}

const conflictMarkers = git([
  'grep',
  '-n',
  '-I',
  '-E',
  '^(<<<<<<< |=======$|>>>>>>> )',
  '--',
  '.',
]);
record(
  conflictMarkers.status === 1,
  'No unresolved conflict markers exist in tracked files.',
  conflictMarkers.status === 1
    ? ''
    : `Conflict markers found:\n${conflictMarkers.stdout || conflictMarkers.stderr}`,
);

const whitespace = git(['diff', '--check']);
record(
  whitespace.status === 0 && whitespace.stdout === '',
  'No whitespace errors in unstaged diffs.',
  `Whitespace errors found:\n${whitespace.stdout || whitespace.stderr}`,
);

console.log('');
for (const check of checks.filter(Boolean)) {
  console.log(`PASS ${check}`);
}

if (failures.length > 0) {
  console.error('');
  for (const failure of failures.filter(Boolean)) {
    console.error(`FAIL ${failure}`);
  }
  console.error(`\nSource-of-truth verification failed with ${failures.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log('\nSource-of-truth verification passed.');
}
