import { useEffect, useState } from "react";
import type { AttributeDef, CriterionOperator } from "../types";
import { formatCount, parseCount } from "../lib/formatCount";
import {
  OPERATOR_LABEL,
  WEIGHT_LABEL,
  convertNumericValue,
  criterionProblem,
  type DraftCriterion,
  type DraftValue,
} from "../lib/profileCriteria";
import { IconX } from "./icons";

interface Props {
  criterion: DraftCriterion;
  def: AttributeDef;
  // Whether a data source fills this attribute on the profile's platform.
  hasData: boolean;
  operators: CriterionOperator[];
  showErrors: boolean;
  onChange: (next: DraftCriterion) => void;
  onRemove: () => void;
  onToggleMode: () => void;
}

// One criterion in the Profile editor. The value control is chosen by the
// attribute's type from the registry — there are no per-attribute
// components, so new registry entries render without UI changes.
export function CriterionRow({
  criterion,
  def,
  hasData,
  operators,
  showErrors,
  onChange,
  onRemove,
  onToggleMode,
}: Props) {
  const problem = criterionProblem(criterion, def);
  const isNumeric = def.type === "count" || def.type === "percent" || def.type === "number";
  const setValue = (value: DraftValue) => onChange({ ...criterion, value });

  const setOperator = (operator: CriterionOperator) =>
    onChange({
      ...criterion,
      operator,
      value: isNumeric ? convertNumericValue(criterion.value, operator) : criterion.value,
    });

  return (
    <div className={`criterion${showErrors && problem ? " criterion--invalid" : ""}`}>
      <div className="criterion__main">
        <div className="criterion__label" title={def.description}>
          {def.label}
          {!hasData && (
            <span
              className="criterion__nodata"
              title="No prospect data source fills this yet — it's saved on the profile and will start counting once one does."
            >
              No data yet
            </span>
          )}
        </div>

        {operators.length > 1 ? (
          <select
            className="criterion__op"
            value={criterion.operator}
            onChange={(e) => setOperator(e.target.value as CriterionOperator)}
            aria-label={`${def.label} comparison`}
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABEL[op]}
              </option>
            ))}
          </select>
        ) : (
          <span className="criterion__op criterion__op--static">
            {OPERATOR_LABEL[criterion.operator]}
          </span>
        )}

        <div className="criterion__value">
          {isNumeric && criterion.operator === "between" && (
            <>
              <NumberField
                def={def}
                value={(criterion.value as [number | null, number | null])[0]}
                onChange={(v) => setValue([v, (criterion.value as [number | null, number | null])[1]])}
                placeholder="min"
              />
              <span className="criterion__dash">–</span>
              <NumberField
                def={def}
                value={(criterion.value as [number | null, number | null])[1]}
                onChange={(v) => setValue([(criterion.value as [number | null, number | null])[0], v])}
                placeholder="max"
              />
            </>
          )}
          {isNumeric && criterion.operator !== "between" && (
            <NumberField
              def={def}
              value={criterion.value as number | null}
              onChange={setValue}
              placeholder={def.type === "count" ? "e.g. 10k" : "value"}
            />
          )}
          {isNumeric && def.unit && <span className="criterion__unit">{def.unit}</span>}
          {def.type === "enum" && (
            <EnumPicker def={def} value={criterion.value as string[]} onChange={setValue} />
          )}
          {def.type === "keywords" && (
            <KeywordInput value={criterion.value as string[]} onChange={setValue} />
          )}
          {def.type === "boolean" && (
            <div className="segmented" role="group" aria-label={def.label}>
              {[true, false].map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  className={criterion.value === b ? "segmented__btn segmented__btn--on" : "segmented__btn"}
                  onClick={() => setValue(b)}
                >
                  {b ? "Yes" : "No"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="criterion__actions">
          {criterion.mode === "preferred" && (
            <div className="weight" role="group" aria-label="Importance">
              {([1, 2, 3] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  className={(criterion.weight ?? 2) >= w ? "weight__dot weight__dot--on" : "weight__dot"}
                  onClick={() => onChange({ ...criterion, weight: w })}
                  title={`${WEIGHT_LABEL[w]} importance`}
                  aria-label={`${WEIGHT_LABEL[w]} importance`}
                  aria-pressed={criterion.weight === w}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            className="criterion__move"
            onClick={onToggleMode}
            title={criterion.mode === "required" ? "Move to Nice to have" : "Move to Must have"}
          >
            {criterion.mode === "required" ? "↓ Nice" : "↑ Must"}
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--ghost"
            onClick={onRemove}
            aria-label={`Remove ${def.label}`}
            title="Remove"
          >
            <IconX size={13} />
          </button>
        </div>
      </div>
      {showErrors && problem && <div className="criterion__problem">{problem}</div>}
    </div>
  );
}

// Free-typed number that accepts "10k" / "1.2M" for counts. Keeps its own
// text so partial input ("1.") isn't clobbered by reformatting mid-typing.
function NumberField({
  def,
  value,
  onChange,
  placeholder,
}: {
  def: AttributeDef;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
}) {
  const display = (v: number | null) =>
    v == null ? "" : def.type === "count" ? formatCount(v) : String(v);
  const [text, setText] = useState(display(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const invalid = text.trim() !== "" && parseCount(text) == null;

  return (
    <input
      className={`criterion__num${invalid ? " criterion__num--invalid" : ""}`}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseCount(e.target.value));
      }}
    />
  );
}

const CHIP_THRESHOLD = 6;

// Few options (account type) -> toggle chips. Many (country) -> selected
// chips plus an "add" dropdown, so the row doesn't turn into a wall.
function EnumPicker({
  def,
  value,
  onChange,
}: {
  def: AttributeDef;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const options = def.options ?? [];
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  if (options.length <= CHIP_THRESHOLD) {
    return (
      <div className="chips">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value.includes(o.value) ? "chip chip--on" : "chip"}
            onClick={() => toggle(o.value)}
            aria-pressed={value.includes(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  const remaining = options.filter((o) => !value.includes(o.value));
  return (
    <div className="chips">
      {value.map((v) => (
        <span key={v} className="chip chip--on">
          {options.find((o) => o.value === v)?.label ?? v}
          <button type="button" className="chip__x" onClick={() => toggle(v)} aria-label={`Remove ${v}`}>
            <IconX size={10} />
          </button>
        </span>
      ))}
      {remaining.length > 0 && (
        <select
          className="chips__add"
          value=""
          onChange={(e) => e.target.value && toggle(e.target.value)}
          aria-label={`Add ${def.label}`}
        >
          <option value="">+ Add…</option>
          {remaining.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// Tag input: Enter or comma commits, Backspace on empty removes the last.
// Pasting "gym, fitness, yoga" adds all three.
function KeywordInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState("");

  const commit = (raw: string) => {
    const words = raw
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !value.includes(w));
    if (words.length) onChange([...value, ...Array.from(new Set(words))]);
    setText("");
  };

  return (
    <div className="chips chips--input">
      {value.map((w) => (
        <span key={w} className="chip chip--on">
          {w}
          <button
            type="button"
            className="chip__x"
            onClick={() => onChange(value.filter((x) => x !== w))}
            aria-label={`Remove ${w}`}
          >
            <IconX size={10} />
          </button>
        </span>
      ))}
      <input
        className="chips__text"
        value={text}
        placeholder={value.length ? "" : "type and press Enter"}
        onChange={(e) => {
          if (e.target.value.includes(",")) commit(e.target.value);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && commit(text)}
      />
    </div>
  );
}
