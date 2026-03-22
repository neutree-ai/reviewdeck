# Getting a diff

## Local git

```bash
# Current branch vs main
git diff main...HEAD

# Between two commits
git diff <commit-a> <commit-b>

# Staged changes
git diff --cached
```

## GitHub CLI

```bash
# PR diff by number
gh pr diff 123

# Specific PR in another repo
gh pr diff 123 --repo owner/repo
```
