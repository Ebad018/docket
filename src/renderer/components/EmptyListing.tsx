import { IconOpen } from './icons';

interface EmptyListingProps {
  onOpenDialog(): void;
  onRestoreSamples(): void;
}

const FORMATS: readonly [string, string, string][] = [
  ['MD', 'listing__stock--md', 'Markdown — edit the source, save it back'],
  ['DOC', 'listing__stock--doc', 'Word — edit paragraph text, keep the styling'],
  ['XLS', 'listing__stock--xls', 'Excel — edit cells and formulas'],
  ['PDF', 'listing__stock--pdf', 'PDF — highlight, annotate, reorder pages']
];

/** The empty state teaches the model: nothing is here because nothing has been
 *  opened yet, and that is the only thing that puts entries on this sheet. */
export const EmptyListing = ({ onOpenDialog, onRestoreSamples }: EmptyListingProps) => (
  <div className="emptylisting">
    <span className="stamp">Listing · no entries</span>
    <h1 className="emptylisting__title">Nothing printed yet</h1>
    <div className="emptylisting__rule" />

    <p className="emptylisting__lede">
      Every document you open in Docket is recorded here — its name, the folder it
      came from, and the moment you opened it. Nothing else writes to this sheet:
      Docket does not scan your drives, and nothing about your files leaves this
      machine.
    </p>

    <div className="emptylisting__actions">
      <button type="button" className="control control--primary" onClick={onOpenDialog}>
        <IconOpen />
        Open a document
      </button>
      <button type="button" className="control" onClick={onRestoreSamples}>
        Write four sample documents
      </button>
    </div>

    <div className="emptylisting__formats">
      {FORMATS.map(([code, className, description]) => (
        <span className="emptylisting__format" key={code}>
          <span className={`listing__stock ${className}`}>{code}</span>
          {description}
        </span>
      ))}
    </div>

    <p className="emptylisting__lede" style={{ fontSize: 'var(--size-small)' }}>
      You can also drag files straight onto this sheet, or set Docket as the
      default application for any of these formats in Windows.
    </p>
  </div>
);
