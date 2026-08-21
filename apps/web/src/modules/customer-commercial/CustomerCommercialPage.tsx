/** Phase 10 — Customer & Commercial completion (CUS.4). */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type CommercialService,
  type ContractRecord,
  type Customer,
  type CustomerContact,
  type CustomerServiceLink,
  type ProjectRecord,
  type SiteRecord,
} from "../../lib/api";
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  Textarea,
  type Column,
} from "../../shell/components/ui";

type OrgUnit = { id: string; parentId: string | null; name: string; unitType: string; legalEntityId: string };

type DetailState = {
  contacts: CustomerContact[];
  contracts: ContractRecord[];
  projects: ProjectRecord[];
  sites: SiteRecord[];
  links: CustomerServiceLink[];
};

const emptyDetail: DetailState = {
  contacts: [],
  contracts: [],
  projects: [],
  sites: [],
  links: [],
};

function statusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  const normalized = status.toLowerCase();
  if (["active", "current", "open"].includes(normalized)) return "success";
  if (["inactive", "ended", "cancelled", "terminated"].includes(normalized)) return "danger";
  if (["draft", "planned", "pending"].includes(normalized)) return "warning";
  return "info";
}

function nullableValue(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function optionalValue(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function maintenanceStatus(status: string): { label: string; next: string } {
  return status.toLowerCase() === "active"
    ? { label: "Deactivate", next: "inactive" }
    : { label: "Reactivate", next: "active" };
}

export function CustomerCommercialPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [permissions, setPermissions] = useState<string[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<CommercialService[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [detail, setDetail] = useState<DetailState>(emptyDetail);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const canReadContract = permissions.includes("contract.read") || permissions.includes("contract.manage");
  const canReadProject = permissions.includes("project.read") || permissions.includes("project.manage");
  const canReadSite = permissions.includes("site.read") || permissions.includes("site.manage");
  const canReadService = permissions.includes("service.read") || permissions.includes("service.manage");
  const canManageCustomer = permissions.includes("customer.manage");
  const canManageContract = permissions.includes("contract.manage");
  const canManageProject = permissions.includes("project.manage");
  const canManageSite = permissions.includes("site.manage");
  const canManageService = permissions.includes("service.manage");

  const loadDetail = useCallback(
    async (customerId: string, currentPermissions: string[]) => {
      if (!customerId) {
        setDetail(emptyDetail);
        return;
      }
      setDetailLoading(true);
      try {
        const [contacts, contracts, projects, sites, links] = await Promise.all([
          api.customerContacts(token, customerId),
          currentPermissions.includes("contract.read") || currentPermissions.includes("contract.manage")
            ? api.contracts(token, customerId)
            : Promise.resolve([]),
          currentPermissions.includes("project.read") || currentPermissions.includes("project.manage")
            ? api.projectsForCustomer(token, customerId)
            : Promise.resolve([]),
          currentPermissions.includes("site.read") || currentPermissions.includes("site.manage")
            ? api.sitesForCustomer(token, customerId)
            : Promise.resolve([]),
          currentPermissions.includes("service.read") || currentPermissions.includes("service.manage")
            ? api.customerServiceLinks(token, customerId)
            : Promise.resolve([]),
        ]);
        setDetail({ contacts, contracts, projects, sites, links });
      } catch (err) {
        setMessage({
          type: "error",
          text: err instanceof ApiError ? err.message : "Could not load customer commercial detail.",
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [token],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const me = await api.me(token);
      setPermissions(me.permissions);
      const [customerList, serviceList, unitList] = await Promise.all([
        api.customers(token),
        me.permissions.includes("service.read") || me.permissions.includes("service.manage")
          ? api.commercialServices(token)
          : Promise.resolve([]),
        api.organizationUnits(token).catch(() => []),
      ]);
      setCustomers(customerList);
      setServices(serviceList);
      const nextCustomerId = customerList.some((customer) => customer.id === selectedCustomerId)
        ? selectedCustomerId
        : (customerList[0]?.id ?? "");
      setSelectedCustomerId(nextCustomerId);
      setOrgUnits(unitList);
      await loadDetail(nextCustomerId, me.permissions);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Could not load customers." });
    } finally {
      setLoading(false);
    }
  }, [loadDetail, selectedCustomerId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reloadSelected(successText: string) {
    setMessage({ type: "success", text: successText });
    const [customerList, serviceList] = await Promise.all([
      api.customers(token),
      canReadService ? api.commercialServices(token) : Promise.resolve([]),
    ]);
    setCustomers(customerList);
    setServices(serviceList);
    const nextCustomerId = customerList.some((customer) => customer.id === selectedCustomerId)
      ? selectedCustomerId
      : (customerList[0]?.id ?? "");
    setSelectedCustomerId(nextCustomerId);
    await loadDetail(nextCustomerId, permissions);
  }

  async function handleCustomerChange(customerId: string) {
    setSelectedCustomerId(customerId);
    setMessage(null);
    await loadDetail(customerId, permissions);
  }

  async function submitForm(e: FormEvent<HTMLFormElement>, action: (form: FormData) => Promise<void>) {
    e.preventDefault();
    try {
      await action(new FormData(e.currentTarget));
      e.currentTarget.reset();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Request failed." });
    }
  }

  const customerColumns: Column<Customer>[] = [
    { header: "Customer", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Code", cell: (row) => row.code },
    { header: "Owner OU", cell: (row) => orgUnits.find((unit) => unit.id === row.ownerOrganizationUnitId)?.name ?? "—" },
    { header: "Status", cell: (row) => <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill> },
    ...(canManageCustomer
      ? [
          {
            header: "Actions",
            cell: (row) => {
              const transition = maintenanceStatus(row.status);
              return (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    void api
                      .updateCustomer(token, row.id, { status: transition.next })
                      .then(() => reloadSelected(`Customer ${transition.next === "active" ? "reactivated" : "deactivated"}.`))
                      .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Status update failed." }));
                  }}
                >
                  {transition.label}
                </Button>
              );
            },
          } satisfies Column<Customer>,
        ]
      : []),
  ];

  const contactColumns: Column<CustomerContact>[] = [
    { header: "Name", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Email", cell: (row) => row.email ?? "—" },
    { header: "Phone", cell: (row) => row.phone ?? "—" },
    { header: "Primary", cell: (row) => (row.isPrimary ? <StatusPill tone="success">Primary</StatusPill> : "—") },
    ...(canManageCustomer
      ? [
          {
            header: "Actions",
            cell: (row) => (
              <Button
                type="button"
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  void api
                    .updateCustomerContact(token, row.id, { isPrimary: !row.isPrimary })
                    .then(() => reloadSelected("Contact updated."))
                    .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Contact update failed." }));
                }}
              >
                {row.isPrimary ? "Unset primary" : "Set primary"}
              </Button>
            ),
          } satisfies Column<CustomerContact>,
        ]
      : []),
  ];

  const contractColumns: Column<ContractRecord>[] = [
    { header: "Contract", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Code", cell: (row) => row.code },
    { header: "Period", cell: (row) => `${row.startDate ?? "—"} → ${row.endDate ?? "—"}` },
    { header: "Status", cell: (row) => <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill> },
    ...(canManageContract
      ? [
          {
            header: "Actions",
            cell: (row) => {
              const transition = maintenanceStatus(row.status);
              return (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void api
                      .updateContract(token, row.id, { status: transition.next })
                      .then(() => reloadSelected(`Contract ${transition.next === "active" ? "reactivated" : "deactivated"}.`))
                      .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Contract update failed." }))
                  }
                >
                  {transition.label}
                </Button>
              );
            },
          } satisfies Column<ContractRecord>,
        ]
      : []),
  ];

  const projectColumns: Column<ProjectRecord>[] = [
    { header: "Project", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Code", cell: (row) => row.code },
    { header: "Contract", cell: (row) => detail.contracts.find((contract) => contract.id === row.contractId)?.code ?? "—" },
    { header: "Status", cell: (row) => <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill> },
    ...(canManageProject
      ? [
          {
            header: "Actions",
            cell: (row) => {
              const transition = maintenanceStatus(row.status);
              return (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void api
                      .updateProject(token, row.id, { status: transition.next })
                      .then(() => reloadSelected(`Project ${transition.next === "active" ? "reactivated" : "deactivated"}.`))
                      .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Project update failed." }))
                  }
                >
                  {transition.label}
                </Button>
              );
            },
          } satisfies Column<ProjectRecord>,
        ]
      : []),
  ];

  const siteColumns: Column<SiteRecord>[] = [
    { header: "Site / Location", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Code", cell: (row) => row.code },
    { header: "Project", cell: (row) => detail.projects.find((project) => project.id === row.projectId)?.code ?? "—" },
    { header: "Address", cell: (row) => row.address ?? "—" },
    { header: "Status", cell: (row) => <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill> },
    ...(canManageSite
      ? [
          {
            header: "Actions",
            cell: (row) => {
              const transition = maintenanceStatus(row.status);
              return (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void api
                      .updateSite(token, row.id, { status: transition.next })
                      .then(() => reloadSelected(`Site ${transition.next === "active" ? "reactivated" : "deactivated"}.`))
                      .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Site update failed." }))
                  }
                >
                  {transition.label}
                </Button>
              );
            },
          } satisfies Column<SiteRecord>,
        ]
      : []),
  ];

  const serviceColumns: Column<CommercialService>[] = [
    { header: "Service", cell: (row) => <span className="font-medium">{row.name}</span> },
    { header: "Code", cell: (row) => row.code },
    { header: "Description", cell: (row) => row.description ?? "—" },
    { header: "Active", cell: (row) => <StatusPill tone={row.isActive ? "success" : "danger"}>{row.isActive ? "Active" : "Inactive"}</StatusPill> },
    ...(canManageService
      ? [
          {
            header: "Actions",
            cell: (row) => (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void api
                    .updateCommercialService(token, row.id, { isActive: !row.isActive })
                    .then(() => reloadSelected(`Service ${row.isActive ? "deactivated" : "reactivated"}.`))
                    .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Service update failed." }))
                }
              >
                {row.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            ),
          } satisfies Column<CommercialService>,
        ]
      : []),
  ];

  const linkColumns: Column<CustomerServiceLink>[] = [
    { header: "Service", cell: (row) => services.find((service) => service.id === row.serviceId)?.name ?? row.serviceId.slice(0, 8) },
    { header: "Contract", cell: (row) => detail.contracts.find((contract) => contract.id === row.contractId)?.code ?? "—" },
    { header: "Project", cell: (row) => detail.projects.find((project) => project.id === row.projectId)?.code ?? "—" },
    { header: "Site", cell: (row) => detail.sites.find((site) => site.id === row.siteId)?.code ?? "—" },
    { header: "Status", cell: (row) => <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill> },
    ...(canManageService
      ? [
          {
            header: "Actions",
            cell: (row) => {
              const transition = maintenanceStatus(row.status);
              return (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void api
                      .updateCustomerServiceLink(token, row.id, { status: transition.next })
                      .then(() => reloadSelected(`Service link ${transition.next === "active" ? "reactivated" : "deactivated"}.`))
                      .catch((err) => setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Service link update failed." }))
                  }
                >
                  {transition.label}
                </Button>
              );
            },
          } satisfies Column<CustomerServiceLink>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer & Commercial"
        subtitle="Manage customers, contacts, contracts, projects, sites, service catalog, and customer-service links through the existing scope-safe APIs."
        actions={<Button onClick={load}>Refresh</Button>}
      />

      {message ? <Alert tone={message.type}>{message.text}</Alert> : null}

      <Card>
        <p className="text-sm text-slate-600">
          Create, update, and deactivate/reactivate maintenance uses Customer & Commercial backend endpoints with tenant isolation, RBAC, Customer Data Scope, audit logging, and no hard-delete behavior enforced server-side.
        </p>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <Card className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Customers</h2>
                  <p className="text-sm text-slate-500">Rows are already limited to the caller's Customer Data Scope.</p>
                </div>
                <Select value={selectedCustomerId} onChange={(event) => void handleCustomerChange(event.target.value)} className="sm:max-w-xs">
                  <option value="">Select customer…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.code} — {customer.name}
                    </option>
                  ))}
                </Select>
              </div>
              <DataTable
                columns={customerColumns}
                rows={customers}
                keyOf={(row) => row.id}
                onRowClick={(row) => void handleCustomerChange(row.id)}
                empty={<EmptyState title="No customers yet" description="Create the first customer from the form on this page." />}
              />
            </Card>

            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Create customer</h2>
              {canManageCustomer ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) =>
                    void submitForm(event, async (form) => {
                      await api.createCustomer(token, {
                        code: String(form.get("code")).trim(),
                        name: String(form.get("name")).trim(),
                        status: optionalValue(form.get("status")),
                        ownerOrganizationUnitId: nullableValue(form.get("ownerOrganizationUnitId")),
                        notes: nullableValue(form.get("notes")),
                      });
                      await reloadSelected("Customer created.");
                    })
                  }
                >
                  <Field label="Code" required><Input name="code" required /></Field>
                  <Field label="Name" required><Input name="name" required /></Field>
                  <Field label="Status"><Input name="status" placeholder="active" /></Field>
                  <Field label="Owning organization unit">
                    <Select name="ownerOrganizationUnitId">
                      <option value="">(none)</option>
                      {orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Notes"><Textarea name="notes" rows={3} /></Field>
                  <Button type="submit">Create customer</Button>
                </form>
              ) : (
                <p className="text-sm text-slate-500">You need customer.manage to create customers.</p>
              )}
            </Card>
          </div>

          {selectedCustomer ? (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <RecordSection
                title="Contacts"
                description={`Contacts for ${selectedCustomer.name}.`}
                loading={detailLoading}
                table={
                  <DataTable
                    columns={contactColumns}
                    rows={detail.contacts}
                    keyOf={(row) => row.id}
                    empty={<EmptyState title="No contacts yet" description="Add the first contact for this customer." />}
                  />
                }
                form={
                  canManageCustomer ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        void submitForm(event, async (form) => {
                          await api.createCustomerContact(token, {
                            customerId: selectedCustomer.id,
                            name: String(form.get("name")).trim(),
                            email: nullableValue(form.get("email")),
                            phone: nullableValue(form.get("phone")),
                            isPrimary: form.get("isPrimary") === "on",
                          });
                          await reloadSelected("Contact created.");
                        })
                      }
                    >
                      <Field label="Name" required><Input name="name" required /></Field>
                      <Field label="Email"><Input name="email" type="email" /></Field>
                      <Field label="Phone"><Input name="phone" /></Field>
                      <label className="flex items-center gap-2 text-sm text-slate-700"><input name="isPrimary" type="checkbox" /> Primary contact</label>
                      <Button type="submit">Add contact</Button>
                    </form>
                  ) : null
                }
              />

              {canReadContract ? (
                <RecordSection
                  title="Contracts"
                  description="Commercial agreements belonging to the selected customer."
                  loading={detailLoading}
                  table={
                    <DataTable
                      columns={contractColumns}
                      rows={detail.contracts}
                      keyOf={(row) => row.id}
                      empty={<EmptyState title="No contracts yet" description="Create a contract for this customer." />}
                    />
                  }
                  form={
                    canManageContract ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        void submitForm(event, async (form) => {
                          await api.createContract(token, {
                            customerId: selectedCustomer.id,
                            code: String(form.get("code")).trim(),
                            name: String(form.get("name")).trim(),
                            startDate: nullableValue(form.get("startDate")),
                            endDate: nullableValue(form.get("endDate")),
                            status: optionalValue(form.get("status")),
                          });
                          await reloadSelected("Contract created.");
                        })
                      }
                    >
                      <Field label="Code" required><Input name="code" required /></Field>
                      <Field label="Name" required><Input name="name" required /></Field>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Start date"><Input name="startDate" type="date" /></Field>
                        <Field label="End date"><Input name="endDate" type="date" /></Field>
                      </div>
                      <Field label="Status"><Input name="status" placeholder="active" /></Field>
                      <Button type="submit">Create contract</Button>
                    </form>
                    ) : null
                  }
                />
              ) : null}

              {canReadProject ? (
                <RecordSection
                  title="Projects"
                description="Project master records for downstream operations and project delivery."
                loading={detailLoading}
                table={
                  <DataTable
                    columns={projectColumns}
                    rows={detail.projects}
                    keyOf={(row) => row.id}
                    empty={<EmptyState title="No projects yet" description="Create a project under this customer." />}
                  />
                }
                form={
                  canManageProject ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        void submitForm(event, async (form) => {
                          await api.createProject(token, {
                            customerId: selectedCustomer.id,
                            contractId: nullableValue(form.get("contractId")),
                            code: String(form.get("code")).trim(),
                            name: String(form.get("name")).trim(),
                            status: optionalValue(form.get("status")),
                          });
                          await reloadSelected("Project created.");
                        })
                      }
                    >
                      <Field label="Code" required><Input name="code" required /></Field>
                      <Field label="Name" required><Input name="name" required /></Field>
                      <Field label="Contract">
                        <Select name="contractId">
                          <option value="">(none)</option>
                          {detail.contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.code} — {contract.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Status"><Input name="status" placeholder="active" /></Field>
                      <Button type="submit">Create project</Button>
                    </form>
                  ) : null
                }
                />
              ) : null}

              {canReadSite ? (
                <RecordSection
                  title="Sites / Locations"
                description="Operational locations under the selected customer and project."
                loading={detailLoading}
                table={
                  <DataTable
                    columns={siteColumns}
                    rows={detail.sites}
                    keyOf={(row) => row.id}
                    empty={<EmptyState title="No sites yet" description="Create a site/location for this customer." />}
                  />
                }
                form={
                  canManageSite ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        void submitForm(event, async (form) => {
                          await api.createSite(token, {
                            customerId: selectedCustomer.id,
                            projectId: nullableValue(form.get("projectId")),
                            code: String(form.get("code")).trim(),
                            name: String(form.get("name")).trim(),
                            address: nullableValue(form.get("address")),
                            status: optionalValue(form.get("status")),
                          });
                          await reloadSelected("Site/location created.");
                        })
                      }
                    >
                      <Field label="Code" required><Input name="code" required /></Field>
                      <Field label="Name" required><Input name="name" required /></Field>
                      <Field label="Project">
                        <Select name="projectId">
                          <option value="">(none)</option>
                          {detail.projects.map((project) => <option key={project.id} value={project.id}>{project.code} — {project.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Address"><Textarea name="address" rows={2} /></Field>
                      <Field label="Status"><Input name="status" placeholder="active" /></Field>
                      <Button type="submit">Create site</Button>
                    </form>
                  ) : null
                }
                />
              ) : null}

              {canReadService ? (
                <RecordSection
                  title="Service Catalog"
                description="Reusable commercial services that can be linked to customers."
                loading={false}
                table={
                  <DataTable
                    columns={serviceColumns}
                    rows={services}
                    keyOf={(row) => row.id}
                    empty={<EmptyState title="No services yet" description="Create the first service catalog entry." />}
                  />
                }
                form={
                  canManageService ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        void submitForm(event, async (form) => {
                          await api.createCommercialService(token, {
                            code: String(form.get("code")).trim(),
                            name: String(form.get("name")).trim(),
                            description: nullableValue(form.get("description")),
                          });
                          await reloadSelected("Service catalog entry created.");
                        })
                      }
                    >
                      <Field label="Code" required><Input name="code" required /></Field>
                      <Field label="Name" required><Input name="name" required /></Field>
                      <Field label="Description"><Textarea name="description" rows={3} /></Field>
                      <Button type="submit">Create service</Button>
                    </form>
                  ) : null
                }
                />
              ) : null}

              {canReadService ? (
                <RecordSection
                  title="Customer-Service Links"
                description="Connect services to this customer, optionally scoped to contract, project, or site."
                loading={detailLoading}
                table={
                  <DataTable
                    columns={linkColumns}
                    rows={detail.links}
                    keyOf={(row) => row.id}
                    empty={<EmptyState title="No service links yet" description="Link a service to this customer." />}
                  />
                }
                form={
                  canManageService ? (
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        void submitForm(event, async (form) => {
                          await api.createCustomerServiceLink(token, {
                            customerId: selectedCustomer.id,
                            serviceId: String(form.get("serviceId")),
                            contractId: nullableValue(form.get("contractId")),
                            projectId: nullableValue(form.get("projectId")),
                            siteId: nullableValue(form.get("siteId")),
                            internalPicUserId: nullableValue(form.get("internalPicUserId")),
                          });
                          await reloadSelected("Customer-service link created.");
                        })
                      }
                    >
                      <Field label="Service" required>
                        <Select name="serviceId" required>
                          <option value="">Select service…</option>
                          {services.map((service) => <option key={service.id} value={service.id}>{service.code} — {service.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Contract">
                        <Select name="contractId"><option value="">(none)</option>{detail.contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.code}</option>)}</Select>
                      </Field>
                      <Field label="Project">
                        <Select name="projectId"><option value="">(none)</option>{detail.projects.map((project) => <option key={project.id} value={project.id}>{project.code}</option>)}</Select>
                      </Field>
                      <Field label="Site / Location">
                        <Select name="siteId"><option value="">(none)</option>{detail.sites.map((site) => <option key={site.id} value={site.id}>{site.code}</option>)}</Select>
                      </Field>
                      <Field label="Internal PIC user ID"><Input name="internalPicUserId" placeholder="optional UUID" /></Field>
                      <Button type="submit">Link service</Button>
                    </form>
                  ) : null
                }
                />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function RecordSection({
  title,
  description,
  loading,
  table,
  form,
}: {
  title: string;
  description: string;
  loading: boolean;
  table: ReactNode;
  form?: ReactNode;
}) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {loading ? <Spinner /> : table}
      {form ? <div className="border-t border-slate-100 pt-4">{form}</div> : null}
    </Card>
  );
}
