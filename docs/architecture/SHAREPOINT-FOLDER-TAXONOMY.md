# SharePoint folder taxonomy (BL-051 — draft)

**Status:** Light planning only. No Graph API / app registration yet.  
**Locked:** SharePoint is the office document library; Connect stores links + Hub metadata. Vercel disk is not used for audited documents.

Office creates this structure in Microsoft 365 (or maps existing libraries to these paths). Connect later deep-links into the same tree.

## Site

Recommended: one SharePoint site, e.g. **YADA Corporate Records** (name flexible).

| Library | Purpose | Sensitivity |
|---------|---------|-------------|
| `01_Clients` | Participant signed packs, plans (if filed), medical/support evidence | Restricted — need-to-know |
| `02_Workforce` | Staff + volunteer induction, WWCC, screening, HR certs | Restricted — HR |
| `03_Accompanying` | Accompanying person declarations / WWCC evidence | Restricted |
| `04_Vehicles_Assets` | Servicing slips, rego, asset maintenance PDFs | Internal |
| `05_Policies_Procedures` | Controlled P&P (BL-092); approved versions only | Internal (public PDFs published separately to website) |
| `06_Governance_Incidents` | Optional export/archive of serious incident packs | Restricted |
| `07_Audit_Packs` | Generated NDIS Audit Pack ZIPs kept for retention | Restricted |

Public website page images/PDFs (BL-119): a **separate** public-web library (e.g. `08_Public_Website` or its own site), shared by DEV/TEST/PROD, anonymously readable. Do **not** put those files in `01`–`07`. Logo/favicon/brand colours remain BL-113.

## Person folders

Use a stable, searchable name + Connect id when known:

```
01_Clients/{FamilyName}_{GivenName}_{shortId}/
  Onboarding/
    YYYY-MM-DD_signed_pack.pdf
  Consents/
  Plans_and_funding/          # if office files plans here
  Correspondence/

02_Workforce/{FamilyName}_{GivenName}_{staffId}/
  Induction/
  Certifications/
    WWCC/
    First_Aid/
    Driver_licence/
    NDIS_Worker_Screening/
  HR/

03_Accompanying/{FamilyName}_{GivenName}_{carerId}/
  Declarations/
  WWCC/
```

**Filing location (Connect ALPHA):** until Graph sync exists, operators paste the SharePoint path or folder URL into onboarding **Filing location** (e.g. `01_Clients/Smith_Alex_a1b2/Onboarding`).

## Policies library (`05_Policies_Procedures`)

```
05_Policies_Procedures/
  _Published/                 # current approved PDFs (source for public subset)
  _Drafts/
  Archive/
  By_topic/
    Privacy/
    Complaints/
    Incidents/
    Code_of_conduct/
    Participant_rights/
    …
```

Public site **Policies** page links only to approved public PDFs (CMS media URLs or SharePoint anonymous/guest links — decide at BL-051 build). Full procedures stay office-only.

## Naming conventions

| Rule | Example |
|------|---------|
| Dates ISO prefix | `2026-08-10_client_consent_pack.pdf` |
| No PII in public links | Prefer Connect Hub for day-to-day; SharePoint for evidence |
| One “current” signed pack | Superseded packs → `Archive/` under the person folder |
| Certs by type + expiry in filename optional | `WWCC_exp-2027-03-01.pdf` |

## Access (office)

- Day-to-day: open folders in SharePoint / Teams / OneDrive sync.
- From Connect (later BL-051): “Open in SharePoint” on Hub asset / onboarding case.
- Do **not** require staff to download every file through the app for routine filing.

## Out of scope until BL-051 build

- Azure AD app registration / Graph API
- Automated upload from Connect after scan
- Sync of cert expiry from SharePoint into Hub (Hub remains source for dates; SharePoint holds the PDF)

## Validation checklist (when office creates the site)

- [ ] Libraries `01`–`07` exist (or equivalent mapped names documented here)
- [ ] Client / workforce / accompanying folder templates agreed
- [ ] Who can access `01_Clients` vs `02_Workforce` (permissions)
- [ ] Sample Filing location string that operators will paste in Connect
- [ ] Public policy PDF location decided (`_Published` vs CMS media)
