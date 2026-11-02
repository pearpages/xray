import { band, BAND_LABEL } from "../explain";
import "./ScoreChip.css";

/** A metric's score as a small chip, coloured by band; the band is in its accessible name, so colour isn't alone. */
export function ScoreChip({ score }: { score: number | null }) {
  const b = band(score);
  return (
    <span className="score-chip" data-band={b} aria-label={`${score ?? "not measured"}, ${BAND_LABEL[b].toLowerCase()}`}>
      {score ?? "–"}
    </span>
  );
}
