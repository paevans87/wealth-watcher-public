[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$SourceRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

$sourcePath = (Resolve-Path -LiteralPath $SourceRoot).Path
Push-Location -LiteralPath $sourcePath

try {
    $isWorkTree = (git rev-parse --is-inside-work-tree 2>$null).Trim()
    if ($isWorkTree -ne 'true') {
        throw "SourceRoot is not a Git work tree: $sourcePath"
    }

    $head = (git rev-parse --verify HEAD).Trim()
    $branch = (git branch --show-current).Trim()
    $tracked = @(git ls-tree -r --name-only $head)
    $dirty = @(git status --porcelain)

    $exclusions = [ordered]@{
        'OPEN_SOURCE_DEPLOYMENT.md' = 'owner-only deployment plan'
        '.github/workflows/deploy.yml' = 'owner-only deployment workflow'
        'DatabaseSchemaDefinitions.html' = 'legacy tracked audit export; review before publication'
        'UIInputAudit.html' = 'legacy tracked audit export; review before publication'
        'DatabaseSchemaAudit.html' = 'local audit export'
        'ForecastCalculationsSummary.html' = 'local generated report'
    }

    $included = @($tracked | Where-Object { -not $exclusions.Contains($_) })
    $excludedTracked = @($tracked | Where-Object { $exclusions.Contains($_) })

    Write-Output 'Open-source export dry run'
    Write-Output "Source: $sourcePath"
    Write-Output "Branch: $branch"
    Write-Output "Commit: $head"
    Write-Output "Tracked files in source commit: $($tracked.Count)"
    Write-Output "Files proposed for export: $($included.Count)"
    Write-Output "Files excluded by policy: $($excludedTracked.Count)"

    if ($dirty.Count -gt 0) {
        Write-Warning 'Working tree has changes. This audit reads HEAD for the export and does not include uncommitted files.'
    } else {
        Write-Output 'Working tree: clean'
    }

    Write-Output ''
    Write-Output 'Excluded files present in the source commit:'
    if ($excludedTracked.Count -eq 0) {
        Write-Output '  (none)'
    } else {
        foreach ($path in $excludedTracked) {
            Write-Output "  $path — $($exclusions[$path])"
        }
    }

    $secretPatterns = @(
        '-----BEGIN [^-]+ PRIVATE KEY-----',
        '(?i)(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["'']?(?!\$\{|<|REDACTED|CHANGE_ME|YOUR_|PLACEHOLDER|EXAMPLE|DUMMY)[A-Za-z0-9+/_=-]{12,}',
        '(?i)(password|connectionstring)\s*[:=]\s*["'']?(?!\$\{|<|REDACTED|CHANGE_ME|YOUR_|PLACEHOLDER|EXAMPLE|DUMMY)[^"'']{8,}'
    )

    $secretPatternFiles = New-Object System.Collections.Generic.HashSet[string]
    foreach ($pattern in $secretPatterns) {
        $matches = @(git grep --no-ext-diff -I -l -E $pattern $head -- $included 2>$null)
        foreach ($match in $matches) {
            [void]$secretPatternFiles.Add($match)
        }
    }

    Write-Output ''
    Write-Output 'Potential secret-pattern files in the proposed export:'
    if ($secretPatternFiles.Count -eq 0) {
        Write-Output '  (none)'
    } else {
        foreach ($path in ($secretPatternFiles | Sort-Object)) {
            Write-Output "  $path — inspect manually; file contents are not printed"
        }
    }

    $historyCommitCount = [int](git rev-list --count --all)
    $historyRefs = @(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes refs/tags)
    $historySensitivePaths = @(git log --all --name-only --format='' | Sort-Object -Unique | Where-Object {
        $_ -and $_ -match '(?i)(token|secret|credential|password|\.env|\.pem$|\.pfx$|\.db$|\.sqlite|backup|personal|finance)'
    })
    $authorEmails = @(git log --all --format='%ae' | Sort-Object -Unique | Where-Object { $_ })
    $nonGenericAuthorEmails = @($authorEmails | Where-Object {
        $_ -notmatch '(?i)(noreply\.github\.com|dependabot)'
    })

    Write-Output ''
    Write-Output 'Reachable history review:'
    Write-Output "  Commits reachable from local refs: $historyCommitCount"
    Write-Output "  Local/remote/tag refs present: $($historyRefs.Count)"
    Write-Output "  Non-generic author email identities: $($nonGenericAuthorEmails.Count)"
    Write-Output '  Sensitive-looking historical paths:'
    if ($historySensitivePaths.Count -eq 0) {
        Write-Output '    (none)'
    } else {
        foreach ($path in $historySensitivePaths) {
            Write-Output "    $path"
        }
    }
    Write-Output '  Fresh-repository requirement: do not copy this history or these refs.'
    Write-Output ''
    Write-Output 'Result: review the exclusions and findings before creating the public repository.'
}
finally {
    Pop-Location
}
