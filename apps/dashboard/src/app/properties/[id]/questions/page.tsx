"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface Question {
  id: string;
  text: string;
  fieldKey: string;
  type: string;
  required: boolean;
  sortOrder: number;
  isStandard: boolean;
}

export default function QuestionEditorPage() {
  const params = useParams();
  const id = params.id as string;
  const [questions, setQuestions] = useState<Question[]>([]);
  const [propertyName, setPropertyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const loadQuestions = useCallback(async () => {
    try {
      const [qRes, pRes] = await Promise.all([
        fetch(`/api/properties/${id}/questions`),
        fetch(`/api/properties/${id}`),
      ]);
      if (qRes.ok) {
        const data = await qRes.json();
        setQuestions(data.questions || []);
      }
      if (pRes.ok) {
        const data = await pRes.json();
        setPropertyName(data.property?.name || "");
      }
    } catch {
      setError("Failed to load questions");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  async function saveOrder(reordered: Question[]) {
    const order = reordered.map((q, i) => ({ id: q.id, sortOrder: i }));
    await fetch(`/api/properties/${id}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  }

  function handleDragStart(index: number) {
    dragItem.current = index;
  }

  function handleDragEnter(index: number) {
    dragOverItem.current = index;
  }

  async function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;

    const reordered = [...questions];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);

    dragItem.current = null;
    dragOverItem.current = null;

    setQuestions(reordered);
    await saveOrder(reordered);
  }

  async function handleDelete(questionId: string) {
    if (!confirm("Delete this question? Existing application responses won't be affected.")) return;

    const res = await fetch(`/api/properties/${id}/questions/${questionId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete");
    }
  }

  async function handleToggleRequired(question: Question) {
    const res = await fetch(`/api/properties/${id}/questions/${question.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ required: !question.required }),
    });

    if (res.ok) {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === question.id ? { ...q, required: !q.required } : q
        )
      );
    }
  }

  if (loading) {
    return (
      <DashboardShell>
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/properties/${id}`}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        &larr; Back to {propertyName || "Property"}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Questions</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPreview(true)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Preview
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Custom Question
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="mt-2 text-sm text-gray-500">
        Drag to reorder. These questions are asked during the application process.
      </p>
      <p className="text-xs text-gray-400 mt-1">
        Phone number is automatically captured during calls and texts.
      </p>

      {/* Question list */}
      <div className="mt-6 space-y-2">
        {questions.map((q, index) => (
          <div
            key={q.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:shadow-md"
          >
            {/* Drag handle */}
            <span className="cursor-grab text-gray-400 active:cursor-grabbing">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </span>

            {/* Order number */}
            <span className="w-6 text-center text-sm text-gray-400">
              {index + 1}
            </span>

            {/* Content */}
            {editingId === q.id ? (
              <EditInline
                question={q}
                propertyId={id}
                onSave={(updated) => {
                  setQuestions((prev) =>
                    prev.map((qq) => (qq.id === updated.id ? updated : qq))
                  );
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="flex-1">
                  <p className="text-sm text-gray-800">{q.text}</p>
                  <p className="text-xs text-gray-400">
                    {q.fieldKey}
                  </p>
                </div>

                {/* Type badge */}
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {q.type}
                </span>

                {/* Required toggle */}
                <button
                  onClick={() => handleToggleRequired(q)}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    q.required
                      ? "bg-red-50 text-red-600"
                      : "bg-gray-50 text-gray-400"
                  }`}
                  title={q.required ? "Click to make optional" : "Click to make required"}
                >
                  {q.required ? "Required" : "Optional"}
                </button>

                {/* Standard badge */}
                {q.isStandard && (
                  <span className="text-xs text-gray-400" title="System-generated question">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </span>
                )}

                {/* Actions */}
                <button
                  onClick={() => setEditingId(q.id)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  title="Edit"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                  </svg>
                </button>

                {!q.isStandard && (
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="Delete"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {questions.length === 0 && (
        <div className="mt-6 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-gray-500">No questions yet. Add your first question to get started.</p>
        </div>
      )}

      {/* Add question form */}
      {showAdd && (
        <AddQuestionForm
          propertyId={id}
          onAdded={(q) => {
            setQuestions((prev) => [...prev, q]);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal
          questions={questions}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
    </DashboardShell>
  );
}

function EditInline({
  question,
  propertyId,
  onSave,
  onCancel,
}: {
  question: Question;
  propertyId: string;
  onSave: (q: Question) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(question.text);
  const [type, setType] = useState(question.type);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const body: Record<string, unknown> = { text };
    if (!question.isStandard) body.type = type;

    const res = await fetch(
      `/api/properties/${propertyId}/questions/${question.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (res.ok) {
      const data = await res.json();
      onSave(data.question);
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        autoFocus
      />
      {!question.isStandard && (
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="text">Text</option>
          <option value="yes_no">Yes/No</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
        </select>
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "..." : "Save"}
      </button>
      <button
        onClick={onCancel}
        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  );
}

function AddQuestionForm({
  propertyId,
  onAdded,
  onCancel,
}: {
  propertyId: string;
  onAdded: (q: Question) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState("text");
  const [required, setRequired] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    setSaving(true);
    setError("");

    const res = await fetch(`/api/properties/${propertyId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, type, required }),
    });

    const data = await res.json();

    if (res.ok) {
      onAdded(data.question);
    } else {
      setError(data.error || "Failed to add question");
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-900">
        Add Custom Question
      </h3>

      {error && (
        <p className="mb-2 text-xs text-red-600">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700">
            Question Text
          </label>
          <input
            type="text"
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Do you have any felonies?"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            autoFocus
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="text">Text</option>
              <option value="yes_no">Yes/No</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
          </div>

          <div className="flex items-end gap-2 pb-1">
            <input
              type="checkbox"
              id="required"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="required" className="text-sm text-gray-700">
              Required
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add Question"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PreviewModal({
  questions,
  onClose,
}: {
  questions: Question[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Question Preview
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-500">
          The AI will ask these questions in this order during the application:
        </p>

        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.id} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
                {i + 1}
              </span>
              <div>
                <p className="text-sm text-gray-800">{q.text}</p>
                <div className="mt-0.5 flex gap-2">
                  <span className="text-xs text-gray-400">{q.type}</span>
                  {q.required && (
                    <span className="text-xs text-red-400">required</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {questions.length === 0 && (
          <p className="text-center text-sm text-gray-400">
            No questions configured.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
