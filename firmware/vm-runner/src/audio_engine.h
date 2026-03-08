#pragma once

#include <stdint.h>

struct AudioCmdBuffer;

namespace vm_audio {

bool init();
void pump();
void stopAll();
void dispatchCommand(uint8_t id, const uint16_t* args, uint8_t argCount, const uint8_t* memory);
void drainCommands(AudioCmdBuffer& buffer, const uint8_t* memory);

}  // namespace vm_audio
