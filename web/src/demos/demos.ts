import asteroidsBas from "../../examples/asteroids.bas?raw";
import dancePartyBas from "../../examples/dance-party.bas?raw";
import noteDemoBas from "../../examples/note-demo.bas?raw";
import songDemoBas from "../../examples/song-demo.bas?raw";
import starfieldBas from "../../examples/starfield.bas?raw";

export interface Demo {
  name: string;
  source: string;
}

export const DEMOS: Demo[] = [
  { name: "Asteroids", source: asteroidsBas },
  { name: "Dance Party", source: dancePartyBas },
  { name: "Note Demo", source: noteDemoBas },
  { name: "Song Demo", source: songDemoBas },
  { name: "Starfield", source: starfieldBas },
];
