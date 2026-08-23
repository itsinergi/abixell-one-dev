# Platform Experience System & Admin Console UX Direction

| | |
|---|---|
| **Document Status** | APPROVED TARGET ARCHITECTURE & UX SPECIFICATION |
| **Authority** | Founder-authorized Phase 11D; subordinate to canonical PRD and Product Blueprint |
| **Date** | 2026-08-23 |
| **Scope** | Platform Experience System, Modular Navigation, Cross-Device Layout, Business Admin Console UX, and Governed Architect/Builder UX Principles |
| **Related** | [Platform Kernel](platform-kernel.md) · [Dual Admin Console](dual-admin-console.md) · [Builder Risk Model](platform-builder-risk-model.md) · [Module Extension Contracts](module-extension-contracts.md) · [Product Blueprint](../canonical/product-blueprint.md) · [ADR-0003 (Client-Facing Branding)](../adr/0003-client-facing-branding-rule.md) · [ADR-0014 (Static Packages & Governed Builder)](../adr/0014-platform-kernel-static-packages-and-governed-builder.md) |

---

## 1. Executive Summary & Purpose

Phase 11D delivers the **Abixell One Platform Experience System (PES)** — the foundational user experience and interaction architecture for Abixell One as an enterprise-grade, multi-module operations platform.

Following the delivery of the Platform Kernel (Phase 11A), Boundary Enforcement (Phase 11B), and the read-only Business Admin Console foundation (Phase 11C), Phase 11D establishes how all present Core capabilities and future modular extensions manifest consistently across desktop, tablet, and mobile surfaces.

### Core Objectives:
1. **Unify Visual & Interaction Language**: Provide unambiguous design rules for typography, palette, spatial rhythm, elevation, responsive adaptation, and enterprise data density without breaking existing minimalist Tailwind patterns.
2. **Scale Multi-Module Navigation**: Solve navigation discoverability and cognitive load across 11+ business modules, workspace roles, and multi-tier Data Scopes while strictly adhering to client-neutral branding (ADR-0003).
3. **Shape the Business Admin Console UX**: Transition from the Phase 11C read-only overview into a mature, safe, role/permission-governed administration experience with previewable configuration workflows without opening dangerous mutation backdoors.
4. **Define Governed Builder/Architect UX Principles**: Establish the strict design-level user journey for metadata authoring, pre-flight validation, simulation, maker-checker approvals, risk classification (B0–B4), and rollback safeguards — completely divorced from runtime implementation.

---

## 2. Abixell One Visual & Design System Principles

Abixell One employs an **Enterprise Precision & Content-First** aesthetic. The user interface acts as a high-clarity canvas for operational data, workflows, and critical decisions, eschewing ornamental excess.

```
+-------------------------------------------------------------------------------+
|  TYPOGRAPHY          Inter / System Sans: Clear hierarchy (11px to 24px)       |
|  COLOR PALETTE       Slate Neutral Canvas + Semantic Accents (Blue/Amber/Red)  |
|  SPATIAL GRID        4px baseline / 8px component rhythm (Compact Density)    |
|  SURFACE ELEVATION   Subtle 1px Borders (slate-200) + Flat / Low Soft Shadow   |
|  INTERACTION         Predictable focus rings, active states, zero layout jump  |
+-------------------------------------------------------------------------------+
```

### 2.1 Typography System

Typography prioritizes legibility in high-density tables and forms. It utilizes the system font stack backed by `Inter` with tabular numeral alignment for all numerical data.

| Level | Size | Weight | Line Height | Tracking | Usage | Tailwind Class |
|---|---|---|---|---|---|---|
| **Display / Page Title** | 20px (1.25rem) | Semibold (600) | 28px (1.75rem) | -0.01em | Primary Page Header | `text-xl font-semibold` |
| **Section Header** | 16px (1.0rem) | Semibold (600) | 24px (1.5rem) | -0.005em | Card / Panel Title, Modal Title | `text-base font-semibold` |
| **Subsection Header** | 14px (0.875rem) | Medium (500) | 20px (1.25rem) | Normal | Group headers, Table Column Group | `text-sm font-medium` |
| **Body (Default)** | 14px (0.875rem) | Regular (400) | 20px (1.25rem) | Normal | Form inputs, standard body, table cells | `text-sm font-normal` |
| **Body (Strong)** | 14px (0.875rem) | Medium (500) | 20px (1.25rem) | Normal | Key metrics, active labels, table emphasis | `text-sm font-medium` |
| **Small / Table Header** | 12px (0.75rem) | Semibold (600) | 16px (1.0rem) | +0.05em (Upper) | Column headers, Badges, Status Pills | `text-xs font-semibold uppercase tracking-wide` |
| **Caption / Helper** | 12px (0.75rem) | Regular (400) | 16px (1.0rem) | Normal | Input hints, timestamps, secondary metadata | `text-xs text-slate-400` |
| **Code / Monospace** | 12px (0.75rem) | Regular (400) | 16px (1.0rem) | Normal | Permission codes, entity numbers, UUIDs | `font-mono text-xs` |

### 2.2 Palette & Contrast Tokens

The palette is anchored on a refined `Slate` scale to maximize readability in low and bright light environments (such as field operations or control rooms).

```text
Canvas (App background)  : slate-50  (#F8FAFC)
Surface (Cards, panels)  : white     (#FFFFFF)
Border (Structural 1px)  : slate-200 (#E2E8F0)
Border (Input / subtle)  : slate-300 (#CBD5E1)
Primary Text             : slate-900 (#0F172A)
Secondary / Body Text    : slate-700 (#334155)
Muted / Helper Text      : slate-500 (#64748B) / slate-400 (#94A3B8)
```

#### Semantic Feedback Tones

| Semantic Tone | Background | Border | Text | Purpose / Usage |
|---|---|---|---|---|
| **Neutral** | `bg-slate-100` | `border-slate-200` | `text-slate-700` | Inactive items, draft states, neutral metrics |
| **Info / Focus** | `bg-blue-50` | `border-blue-200` | `text-blue-700` | Active links, informational callouts, in-progress stages |
| **Success** | `bg-green-50` | `border-green-200` | `text-green-700` | Approved states, completed jobs, active modules |
| **Warning** | `bg-amber-50` | `border-amber-200` | `text-amber-700` | Offline alerts, near-SLA warnings, review needed |
| **Danger / Error** | `bg-red-50` | `border-red-200` | `text-red-700` | Rejections, critical incidents, validation blockers |

### 2.3 Spatial Scale & Density

- **Baseline Step**: 4px.
- **Card Padding**: Desktop `p-6` (24px), Tablet `p-4` (16px), Mobile `p-3` (12px).
- **Form Element Height**: Standard touch and click target `min-h-[36px]` (desktop) and `min-h-[44px]` (mobile touch targets).
- **Data Density**: Table rows default to `py-2` (compact desktop) to ensure 15–20 rows remain visible above the fold on a standard 1080p display without excessive scrolling.

### 2.4 Surface Elevation & Borders

- **Hierarchy over Shadow**: Depth is communicated primarily through 1px crisp borders (`border-slate-200`) and subtle surface contrasts (`bg-white` over `bg-slate-50`), rather than heavy drop shadows.
- **Layering Stack**:
  - `z-0`: Canvas background (`bg-slate-50`).
  - `z-10`: Sticky headers, persistent desktop sidebar.
  - `z-20`: Dropdowns, popovers, contextual menus.
  - `z-30`: Modal backdrops & dialog sheets.
  - `z-40`: Critical alerts & global connection banners (e.g., Offline bar).

---

## 3. Platform Navigation & Information Architecture

Abixell One integrates multiple operational modules. Navigation must remain effortless whether a tenant operates 2 modules or the entire suite.

```
+-----------------------------------------------------------------------------------------+
|                                    APP SHELL HEADER                                     |
| [Tenant / Workspace Title]                 [Global Scope / Org Indicator]  [User / Out] |
+-----------------------+-----------------------------------------------------------------+
| SIDEBAR NAVIGATION    | MAIN CONTENT REGION                                             |
|                       |                                                                 |
| [Search / Jump ⌘K]   | PageHeader: Title + Breadcrumbs + Action Buttons                |
|                       |                                                                 |
| ▼ OPERATIONS          +-----------------------------------------------------------------+
|   Overview            | KPI Metric Tiles (4-column grid)                                |
|   Complaints / Queue  +-----------------------------------------------------------------+
|   Work Orders         | Data Table / Filter Controls / Tab Strip                        |
|   My Work             |                                                                 |
|                       | [Col 1]     [Col 2]      [Col 3]     [Col 4]     [Actions]      |
| ▼ ENTERPRISE CORE     | Row 1...                                                        |
|   Customers           | Row 2...                                                        |
|   Employees           |                                                                 |
|   Items & Stock       +-----------------------------------------------------------------+
|   Assets              | Pagination / Status Footer                                      |
|   Finance             +-----------------------------------------------------------------+
|                       |                                                                 |
| ▼ GOVERNANCE & ADMIN  |                                                                 |
|   Reporting           |                                                                 |
|   Admin Console       |                                                                 |
+-----------------------+-----------------------------------------------------------------+
```

### 3.1 Three-Tier Grouping Model

To prevent a long, undifferentiated list of navigation links, the sidebar is organized into intuitive domain categories:

1. **Operations (Day-to-Day Execution)**:
   - *Overview*: Personal and workspace dashboard.
   - *My Work / Queue*: Individual task queues, field execution, complaint triaging.
   - *Work Orders & Services*: Field operations, service definitions, dispatch.
   - *Surveys*: Survey authoring and respondent assignments.
2. **Enterprise Core (Master & Resource Management)**:
   - *Customer & Commercial*: Accounts, contacts, contracts, projects, sites.
   - *Workforce*: Employee registry, organizational unit assignments.
   - *Supply Chain*: Items, stock balances, suppliers, purchase requests.
   - *Assets*: Asset registry, locations, custodianship, movement.
   - *Finance*: Chart of accounts, transaction journal, cash flow.
   - *HSE*: Health, safety, environmental register and incident logging.
   - *Project Delivery*: Milestones, deliverables, progress tracking.
3. **Governance & Platform (Oversight & Configuration)**:
   - *Reporting & Insight*: Cross-module reports, CSV exports, executive summaries.
   - *Administration (Legacy)*: Core system settings.
   - *Admin Console (Phase 11C+)*: Tenant-local consolidated governance.

### 3.2 Capability & Data Scope Aware Presentation

Navigation items are rendered strictly according to the actor's effective permissions and Data Scope context derived from `GET /me`:

- **External Customer Users**:
  - Automatically constrained to customer-facing sections (`/complaints`, `/my-surveys`).
  - All internal operational and administrative sections are hidden client-side (and blocked server-side).
- **Internal Field Operators**:
  - Prominently displays `/my-work` and `/queue` while suppressing management and configuration tools.
- **Departmental Managers**:
  - Shows module views filtered automatically to their assigned `OrganizationUnit` Data Scope.
- **Tenant Administrators**:
  - Exposes `/admin` (Admin Console) and configuration management surfaces.

*Rule: Client-side navigation hiding is purely for user clarity and cognitive focus. The backend authoritatively enforces RBAC, Data Scope, and module activation for every single request.*

---

## 4. Multi-Device Layout & Responsive Adaptation

Abixell One is accessed from diverse form factors: control room multi-monitors, office laptops, field tablets, and mobile smartphones.

```
+-------------------+--------------------+---------------------+---------------------+
| FORM FACTOR       | BREAKPOINT         | NAVIGATION SHELL    | DATA DISPLAY PATTERN|
+-------------------+--------------------+---------------------+---------------------+
| Desktop           | md / lg (>= 1024px)| Persistent Sidebar  | Multi-col DataTable |
| (Dense / Monitor) |                    | (240px width)       | Multi-card Grid     |
+-------------------+--------------------+---------------------+---------------------+
| Tablet            | sm / md (768-1023) | Collapsible Drawer /| Scrollable Table /  |
| (Hybrid / Field)  |                    | Compact Icon-Rail   | 2-column Card Grid  |
+-------------------+--------------------+---------------------+---------------------+
| Mobile            | xs (< 768px)       | Top Bar + Slide-out | Stacked Card List   |
| (Touch / Phone)   |                    | Fullscreen Drawer   | Bottom Action Bar   |
+-------------------+--------------------+---------------------+---------------------+
```

### 4.1 Desktop Form Factor (>= 1024px)
- **Structure**: Fixed 240px left sidebar, persistent top workspace banner, expansive central content container (`max-w-7xl` or fluid for wide tables).
- **Interactions**: Hover states on table rows, inline row action buttons, keyboard shortcuts (`/` for table search, `Esc` to close modals).
- **Information Density**: Maximum. Tables show full column sets (code, name, status, dates, assignees, actions) with direct pagination controls.

### 4.2 Tablet & Field Pad Form Factor (768px - 1023px)
- **Structure**: Sidebar can collapse to an icon rail or toggle via header menu button.
- **Interactions**: Touch-friendly padding (`min-h-[40px]`), larger tap targets for filter pills.
- **Information Density**: Moderate. Secondary table columns (e.g., created timestamp, internal IDs) drop to secondary detail drawers or expanders.

### 4.3 Mobile Form Factor (< 768px)
- **Structure**: Compact top bar showing workspace title and hamburger toggle; slide-out navigation overlay.
- **Data Transformation (The 1C.7 Stacked Card Rule)**:
  - Complex horizontal tables transform automatically into **Stacked Card Lists** (`DataTable` mobile layout).
  - Primary title/status pill placed in card header; key-value pairs rendered as clean vertical metadata rows.
- **Action Ergonomics**: Primary submit and workflow action buttons pinned to the viewport bottom with safe-area insets for one-thumb operation.
- **Offline Reliability**: Persistent top banner triggers when `navigator.onLine === false`, clearly notifying field workers that modifications are paused until connectivity resumes.

---

## 5. Enterprise Screen Patterns & Interaction States

### 5.1 Standard Screen Scaffolding

Every page follows a standardized top-to-bottom reading sequence:

```text
[1. Breadcrumb Bar]          Administration / Admin Console / Roles
[2. PageHeader]              Roles & Access Summaries
                             Subtitle: "Read-only summary of tenant-local roles..."
                             [Action Area: Search Input, Export CSV, Primary Action]
[3. Filter & Tab Strip]      [All (12)]  [Full Access (2)]  [Scoped (10)]
[4. Content Region]          DataTable OR Card Grid OR Detail Layout
[5. Footer / Pagination]     Showing 1-10 of 12 roles     [Prev] [1] [2] [Next]
```

### 5.2 Deterministic UI States

Every view handles five mutually exclusive asynchronous states gracefully:

```
+------------------------------------------------------------------------------------+
| 1. LOADING STATE                                                                   |
|    Centered spinner + descriptive label ("Loading tenant configuration...")        |
|    OR animated skeleton placeholder matching final data shape.                     |
+------------------------------------------------------------------------------------+
| 2. EMPTY STATE (No Data Exists)                                                    |
|    Dashed border card + neutral icon + clear title ("No Work Orders Found")        |
|    + actionable guidance or create button (if authorized).                         |
+------------------------------------------------------------------------------------+
| 3. EMPTY FILTER STATE (No Search Matches)                                          |
|    "No results matching 'ABC'". Action: "Clear Filters".                           |
+------------------------------------------------------------------------------------+
| 4. PERMISSION DENIED (403 Forbidden / Capability Missing)                         |
|    Shield / lock indicator + specific missing permission badge                     |
|    ("Requires permission: 'finance.read'") + Link back to Overview.                |
|    *Never shows a cryptic or generic crash message.*                              |
+------------------------------------------------------------------------------------+
| 5. ERROR STATE (Network / 500 Server Error)                                        |
|    Red alert container + human-readable error explanation + "Retry" button.        |
+------------------------------------------------------------------------------------+
```

---

## 6. Business Admin Console UX Direction

The **Business Admin Console** (`/admin`) serves as the command center for tenant administrators, IT coordinators, and compliance officers.

```
+------------------------------------------------------------------------------------+
| BUSINESS ADMIN CONSOLE (/admin)                           [READ ONLY FOUNDATION]   |
+------------------------------------------------------------------------------------+
| [Overview]  [Users]  [Roles]  [Permissions]  [Modules]  [Workflows]  [Audit Log]   |
+------------------------------------------------------------------------------------+
|                                                                                    |
| +-------------------+  +-------------------+  +-------------------+                |
| | USERS             |  | ROLES             |  | PERMISSIONS       |                |
| | 14 Total Active   |  | 5 Configured      |  | 76 Platform Items |                |
| | [user.read]       |  | [config.read]     |  | [config.read]     |                |
| +-------------------+  +-------------------+  +-------------------+                |
| +-------------------+  +-------------------+  +-------------------+                |
| | MODULES           |  | WORKFLOWS         |  | RECENT AUDIT      |                |
| | 10/11 Active      |  | 3 Definitions     |  | 25 Events Logged  |                |
| | [config.read]     |  | [workflow.read]   |  | [audit_log.read]  |                |
| +-------------------+  +-------------------+  +-------------------+                |
|                                                                                    |
| DATA SCOPE SUMMARY                                                                 |
| Tenant: PT Insting Tekno Sinergi (Local isolation verified)                        |
|                                                                                    |
+------------------------------------------------------------------------------------+
```

### 6.1 Foundational Read-Only UX (Phase 11C Baseline)

- **Entry Gating**: Requires `admin.console.read`.
- **Two-Axis Isolation**: Cards and detail tabs remain independently gated by their domain permissions (`user.read`, `config.read`, `workflow.definition.read`, `audit_log.read`).
- **Privacy Shielding**:
  - User views omit password hashes or credential metadata.
  - Audit activity displays action, entity type, actor ID, and timestamp; free-form `metadata` and specific `entityId` are intentionally omitted to prevent leakage of confidential business narratives.
  - Global permission catalogue is clearly identified as platform-wide migration metadata.

### 6.2 Future Governed Editing UX Direction (Design Specification Only)

When future phases introduce administrative mutation capabilities, the UX must follow strict safety patterns:

1. **Pre-flight Impact Analysis**: Before modifying a role's permissions or deactivating a module, the console presents an **Impact Drawer**:
   - Number of assigned users affected.
   - Active workflow definitions that depend on the module/role.
   - Explicit confirmation dialog for high-impact actions.
2. **Side-by-Side Diff View**: Changes to configuration matrices or workflow assignment rules must render a visual diff (Original vs. Proposed) before submission.
3. **No Direct Mutation Surfaces**: The console will never provide raw SQL consoles, runtime script editors, or arbitrary JSON payload editors.

---

## 7. Platform Architect / Builder UX Direction (Design Principles Only)

The **Platform Architect / Builder Console** is the future design-time surface for package authors, solutions architects, and platform engineers (Phase 11A / ADR-0014).

```
+------------------------------------------------------------------------------------+
| PLATFORM BUILDER GOVERNED LIFECYCLE (DESIGN LEVEL ONLY)                            |
|                                                                                    |
|  [ 1. DRAFT ]  ----->  [ 2. VALIDATE ]  ----->  [ 3. SIMULATE ]                   |
|  Finite Metamodel      Deterministic           Isolated Sandbox &                  |
|  Authoring             Rule Engines            Blast-Radius Graph                  |
|                               |                                                    |
|                               v                                                    |
|  [ 6. ROLLBACK ] <---  [ 5. PUBLISH ]   <-----  [ 4. REVIEW & APPROVE ]            |
|  Immutable Digest      Atomic Release          Maker-Checker Gates                 |
|  Reversion             to Catalog              (B0 - B3 Risk Matrix)               |
+------------------------------------------------------------------------------------+
```

### 7.1 UX Rules by Risk Classification (B0–B4)

The Builder UI enforces clear visual gating based on the artifact's classified risk level:

| Risk Tier | UX Presentation & Visual Indicator | Review & Approval Gate UX |
|---|---|---|
| **B0 (Preview)** | `Neutral / Slate Badge` — "Draft Preview" | Self-service; live canvas rendering in side-by-side preview panel. |
| **B1 (Presentation)** | `Info / Blue Badge` — "Configuration Update" | Single authorized publisher confirmation; visual schema validation summary. |
| **B2 (Business Behavior)** | `Warning / Amber Badge` — "Workflow & Logic Change" | Maker-checker review screen; blocks self-approval; displays affected active cases. |
| **B3 (Structural)** | `Danger / Red Badge` — "Persistence / Release Bound" | Multi-party sign-off modal (Architect + Security + Ops); migration impact report. |
| **B4 (Prohibited)** | `Violent Block / Red Lock` — "Prohibited Operation" | **Immediate Ingestion Rejection**: Displays blocking error if SQL/DSL/scripts are detected. |

### 7.2 The Pre-Flight Simulation & Approval Screen

The Architect UX requires a dedicated **Pre-Flight Simulation Hub**:
- **Blast-Radius Visualizer**: Interactive tree diagram showing affected tenant modules, dependent roles, and entity relationships.
- **Rollback Readiness Badge**: Indicates whether the proposed change can be cleanly reverted (B1/B2) or requires a forward migration plan (B3).
- **Digital Signature / Digest Verification**: Clear display of the SHA-256 artifact digest bound to the approval action.

*Strict Architectural Boundary: This section defines target UI/UX design workflows only. No runtime Builder code, dynamic compilers, manifest parsers, or execution engines are introduced.*

---

## 8. Cross-Cutting Standards Checklist

All current and future Abixell One user interfaces must satisfy this compliance checklist:

- [x] **Client-Neutral Language (ADR-0003)**: No internal whitelabel, core-engine, or vendor-specific terminology exposed in UI copy.
- [x] **Strict Server-Side Enforcement**: UI gates exist solely for user ergonomics; the backend independently authorizes every data access.
- [x] **Tabular Numeral Alignment**: All numeric quantities, currency values, dates, and codes use tabular figure fonts.
- [x] **Keyboard Accessibility**: All forms, dialogs, and table pagination are navigable via standard keyboard controls (`Tab`, `Enter`, `Space`, `Esc`).
- [x] **Deterministic Color Usage**: Semantic tones (green, amber, red) are reserved exclusively for statuses, alerts, and critical metrics.
- [x] **Touch Ergonomics**: All interactive elements on tablet and mobile viewports provide at least 44x44px touch targets.
- [x] **Zero Layout Jumps**: Skeletons, spinners, and fixed container bounds prevent content shifting during asynchronous data fetching.

---

## 9. Governance & Lifecycle Note

Phase 11D is an **unweighted architecture and UX specification phase**. It refines the presentation and interaction model of Abixell One without altering core progress calculations, business logic, or database schemas.

- **Core Product Readiness**: 174 / 174 (100.0%)
- **Full Approved Roadmap Progress**: 180 / 353 (51.0%)
- **Runtime Code Modifications**: 0 files (Strictly documentation-driven foundation).
