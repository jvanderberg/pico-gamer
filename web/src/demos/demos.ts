import asteroidsBas from "../../examples/asteroids.bas?raw";
import invadersBas from "../../examples/invaders.bas?raw";
import chiptuneDemoBas from "../../examples/chiptune-demo.bas?raw";
import dancePartyBas from "../../examples/dance-party.bas?raw";
import kesslerBas from "../../examples/kessler.bas?raw";
import muncherBas from "../../examples/muncher.bas?raw";
import noteDemoBas from "../../examples/note-demo.bas?raw";
import scene7ChiptuneBas from "../../examples/scene7-chiptune.bas?raw";
import songDemoBas from "../../examples/song-demo.bas?raw";
import starfieldBas from "../../examples/starfield.bas?raw";
import zeldaOverworldBas from "../../examples/zelda-overworld.bas?raw";

export interface Demo {
  name: string;
  source: string;
}

export const DEMOS: Demo[] = [
  { name: "Invaders", source: invadersBas },
  { name: "Asteroids", source: asteroidsBas },
  { name: "Chiptune Demo", source: chiptuneDemoBas },
  { name: "Dance Party", source: dancePartyBas },
  { name: "Kessler", source: kesslerBas },
  { name: "Muncher", source: muncherBas },
  { name: "Note Demo", source: noteDemoBas },
  { name: "Scene 7 Chiptune", source: scene7ChiptuneBas },
  { name: "Song Demo", source: songDemoBas },
  { name: "Starfield", source: starfieldBas },
  { name: "Zelda Overworld", source: zeldaOverworldBas },
];
