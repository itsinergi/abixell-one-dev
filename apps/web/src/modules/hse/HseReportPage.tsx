/**
 * Phase 7 — Health, Safety & Environment (HSE-CORE-001/002).
 *
 * Report new incident or observation form.
 * Mobile-friendly with date/time pickers for occurred-at timestamp.
 * Submits and redirects to detail view where lifecycle begins.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type HseRecordType,
} from "../../lib/api";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "../../shell/components/ui";

export function HseReportPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [recordType, setRecordType] = useState<HseRecordType>("incident");
  const [categoryCode, setCategoryCode] = useState("");
  const [severityCode, setSeverityCode] = useState("");
  const [occurredDate, setOccurredDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [occurredTime, setOccurredTime] = useState("09:00");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [immediateAction, setImmediateAction] = useState("");
  const [locationDetail, setLocationDetail] = useState("");

  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [severities, setSeverities] = useState<{ code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load reference data
  useState(() => {
    void (async () => {
      setLoading(true);
      try {
        const [categoryList, severityList] = await Promise.all([
          api.configReferenceDataItems(token, "hse_category").catch(() => [] as { code: string; label: string }[]),
          api.configReferenceDataItems(token, "hse_severity").catch(() => [] as { code: string; label: string }[]),
        ]);
        setCategories(categoryList);
        setSeverities(severityList);
        if (categoryList[0]) setCategoryCode(categoryList[0].code);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load reference data.");
      } finally {
        setLoading(false);
      }
    })();
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Combine date and time into ISO timestamp
      const occurredAt = new Date(`${occurredDate}T${occurredTime}:00`).toISOString();

      const created = await api.reportHseRecord(token, {
        recordType,
        categoryCode: categoryCode || null,
        severityCode: severityCode || null,
        occurredAt,
        title,
        summary: summary || null,
        description: description || null,
        immediateAction: immediateAction || null,
        locationDetail: locationDetail || null,
      });
      navigate(`/hse/records/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not report HSE record.");
    } finally {
      setBusy(false);
    }
  }

  const isValid = title.trim().length > 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Report Incident or Observation" subtitle="Capture the event details for the HSE register." />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Event Classification</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Type" required>
            <Select value={recordType} onChange={(e) => setRecordType(e.target.value as HseRecordType)}>
              <option value="incident">Incident</option>
              <option value="observation">Observation</option>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={severityCode} onChange={(e) => setSeverityCode(e.target.value)}>
              <option value="">Select…</option>
              {severities.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">When and Where</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date" required>
            <Input type="date" value={occurredDate} onChange={(e) => setOccurredDate(e.target.value)} />
          </Field>
          <Field label="Time" required>
            <Input type="time" value={occurredTime} onChange={(e) => setOccurredTime(e.target.value)} />
          </Field>
          <Field label="Location Detail">
            <Input
              value={locationDetail}
              onChange={(e) => setLocationDetail(e.target.value)}
              placeholder="e.g. Workshop bay 3"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Description</h2>
        <div className="space-y-3">
          <Field label="Title" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief headline of the event"
            />
          </Field>
          <Field label="Summary">
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-sentence summary for the register"
            />
          </Field>
          <Field label="Full Description">
            <Textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Complete narrative of what happened"
            />
          </Field>
          <Field label="Immediate Action Taken">
            <Textarea
              rows={3}
              value={immediateAction}
              onChange={(e) => setImmediateAction(e.target.value)}
              placeholder="What was done right away (if anything)"
            />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button disabled={busy || !isValid || loading} onClick={() => void submit()}>
          {busy ? <Spinner /> : "Report"}
        </Button>
        <Button variant="secondary" onClick={() => navigate("/hse")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
