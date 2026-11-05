import { IconArrow, IconSearch, IconSpark } from "@/components/icons";

/** Plain GET form so search works before (and without) JavaScript. */
export function SearchForm({
  defaultValue = "",
  autoFocus = false,
  large = false,
  ai = false,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  large?: boolean;
  ai?: boolean;
}) {
  return (
    <form
      action="/help/search"
      role="search"
      className={`flex items-center bg-surface ring-1 ring-line transition-shadow hover:ring-line-strong focus-within:ring-line-strong ${
        large ? "gap-3 rounded-xl py-2 pr-2 pl-4 shadow-[0_1px_2px_rgb(10_13_18/0.03)]" : "gap-2.5 rounded-lg py-1 pr-1 pl-3.5"
      }`}
    >
      {ai ? (
        <IconSpark size={large ? 20 : 16} className="shrink-0 text-faint" />
      ) : (
        <IconSearch size={large ? 18 : 16} className="shrink-0 text-faint" />
      )}
      <input
        name="q"
        type="search"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        required
        aria-label="Search the help center"
        placeholder={ai ? "Ask, search, or explain…" : "Search articles…"}
        className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint ${large ? "h-10 text-[16px]" : "h-9 text-[15px]"}`}
      />
      <button
        aria-label="Search"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-well hover:text-ink"
      >
        <IconArrow size={16} />
      </button>
    </form>
  );
}
