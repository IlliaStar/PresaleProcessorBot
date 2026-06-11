#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy SharePoint artifacts for the Presale Agent Bot using PnP Provisioning.
.PARAMETER SiteUrl
    Target SharePoint site URL. Default: https://t8lxc.sharepoint.com/sites/PresaleAgentBot
.PARAMETER ClientId
    PnP app registration client ID. Default: 50599fd2-6085-4ce9-b4b4-624c4b6f9b23
.PARAMETER AuthMethod
    Authentication method: Interactive (browser popup) or AppOnly (cert). Default: Interactive
.PARAMETER TenantId
    Azure AD Tenant ID (required for AppOnly auth).
.PARAMETER CertificatePath
    Path to PFX certificate for app-only auth.
.PARAMETER CertificatePassword
    Password for the PFX certificate.
.PARAMETER WhatIf
    Preview provisioning without applying changes.
.PARAMETER IdsOnly
    Skip provisioning — only resolve and print SharePoint IDs for .env.
.EXAMPLE
    # Interactive browser login (default)
    ./deploy.ps1

    # Skip provisioning, just resolve IDs
    ./deploy.ps1 -IdsOnly

    # App-only with certificate
    ./deploy.ps1 -AuthMethod AppOnly -TenantId <tid> -CertificatePath ./cert.pfx
#>
param(
    [string]$SiteUrl          = "https://t8lxc.sharepoint.com/sites/PresaleAgentBot",
    [string]$ClientId         = "50599fd2-6085-4ce9-b4b4-624c4b6f9b23",
    [ValidateSet("Interactive", "AppOnly")]
    [string]$AuthMethod       = "Interactive",
    [string]$TenantId,
    [string]$CertificatePath,
    [SecureString]$CertificatePassword,
    [switch]$WhatIf,
    [switch]$IdsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProvisioningFile = Join-Path $PSScriptRoot "provisioning.xml"

function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }

function Resolve-XInclude {
    param([System.Xml.XmlDocument]$Doc, [string]$BaseDir)
    $nsm = New-Object System.Xml.XmlNamespaceManager($Doc.NameTable)
    $nsm.AddNamespace("xi", "http://www.w3.org/2001/XInclude")
    $includes = @($Doc.SelectNodes("//xi:include", $nsm))
    foreach ($xi in $includes) {
        $href     = $xi.GetAttribute("href")
        $fullPath = [IO.Path]::GetFullPath([IO.Path]::Combine($BaseDir, $href))
        if (-not (Test-Path $fullPath)) { throw "xi:include target not found: $fullPath" }
        $fragment = [xml](Get-Content $fullPath -Raw -Encoding UTF8)
        $imported = $Doc.ImportNode($fragment.DocumentElement, $true)
        $xi.ParentNode.ReplaceChild($imported, $xi) | Out-Null
    }
}

# ── 1. Check PnP.PowerShell ──────────────────────────────────────────────────
Write-Step "Checking PnP.PowerShell module"
if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
    Write-Warn "PnP.PowerShell not found. Installing..."
    Install-Module PnP.PowerShell -Scope CurrentUser -Force -AllowClobber -SkipPublisherCheck
}
Import-Module PnP.PowerShell -WarningAction SilentlyContinue
Write-Ok "PnP.PowerShell $((Get-Module PnP.PowerShell).Version) loaded"

# ── 2. Connect ───────────────────────────────────────────────────────────────
Write-Step "Connecting to $SiteUrl (method: $AuthMethod)"

switch ($AuthMethod) {
    "Interactive" {
        Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId
    }
    "AppOnly" {
        if (-not $TenantId -or -not $CertificatePath) {
            throw "-TenantId and -CertificatePath are required for AppOnly auth"
        }
        Connect-PnPOnline -Url $SiteUrl `
            -ClientId $ClientId `
            -Tenant $TenantId `
            -CertificatePath $CertificatePath `
            -CertificatePassword $CertificatePassword
    }
}
Write-Ok "Connected"

# ── 3. Apply provisioning templates ──────────────────────────────────────────
if (-not $IdsOnly) {
    if (-not (Test-Path $ProvisioningFile)) { throw "Template not found: $ProvisioningFile" }

    Write-Step "Applying provisioning.xml"
    if ($WhatIf) {
        Write-Host "   [WhatIf] Would apply: $ProvisioningFile" -ForegroundColor DarkYellow
    } else {
        $xmlDoc  = [xml](Get-Content $ProvisioningFile -Raw -Encoding UTF8)
        $baseDir = [IO.Path]::GetDirectoryName($ProvisioningFile)
        Resolve-XInclude -Doc $xmlDoc -BaseDir $baseDir
        $tempFile = [IO.Path]::ChangeExtension([IO.Path]::GetTempFileName(), ".xml")
        $xmlDoc.Save($tempFile)
        try {
            Invoke-PnPSiteTemplate -Path $tempFile
            Write-Ok "provisioning.xml applied"
        } finally {
            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# ── 4. Resolve and print IDs for .env ────────────────────────────────────────
Write-Step "Resolving SharePoint IDs"

$graphSiteId = (Invoke-PnPGraphMethod -Url "sites/t8lxc.sharepoint.com:/sites/PresaleAgentBot" -Method Get).id
$presalesList = Get-PnPList -Identity "Presales"
$drives      = (Invoke-PnPGraphMethod -Url "sites/$graphSiteId/drives" -Method Get).value
$driveId     = ($drives | Where-Object { $_.name -eq "Transcripts" }).id

Write-Host ""
Write-Host ("═" * 58) -ForegroundColor Green
Write-Host "  Add to orchestrator/n8n/.env:" -ForegroundColor Green
Write-Host ("═" * 58) -ForegroundColor Green
Write-Host "SHAREPOINT_SITE_ID=$graphSiteId"
Write-Host "SHAREPOINT_PRESALES_LIST_ID=$($presalesList.Id)"
Write-Host "SHAREPOINT_DRIVE_ID=$driveId"
Write-Host ("═" * 58) -ForegroundColor Green

Disconnect-PnPOnline
Write-Host "`nDone." -ForegroundColor Cyan
