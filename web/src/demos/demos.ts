import asteroidsBas from "../../examples/asteroids.bas?raw";
import starfieldBas from "../../examples/starfield.bas?raw";

export interface Demo {
  name: string;
  source: string;
}

export const DEMOS: Demo[] = [
  { name: "Asteroids", source: asteroidsBas },
  { name: "Starfield", source: starfieldBas },
];
