#pragma once
// Read-only FAT12 filesystem reader
//
// Reads from the flash game partition via XIP (no flash_store needed for reads).
// Parses BPB, enumerates root directory, follows cluster chains.

#include <stdint.h>
#include <stdbool.h>

#define FAT12_MAX_FILENAME  13  // 8.3 + null terminator
#define FAT12_MAX_LFN       64  // long filename buffer (enough for display)

// Directory entry returned by enumeration
struct Fat12Entry {
    char     name[FAT12_MAX_FILENAME];   // "FILENAME.EXT\0" (8.3 short name)
    char     long_name[FAT12_MAX_LFN];   // VFAT long name (empty if none)
    uint32_t size;                       // file size in bytes
    uint16_t first_cluster;              // starting cluster number
    uint8_t  attr;                       // FAT attributes
};

#ifdef __cplusplus
extern "C" {
#endif

// Initialize the FAT12 reader (parses BPB from flash).
// Returns true if a valid FAT12 filesystem was found.
bool fat12_init(void);

// Enumerate root directory entries.
// Calls `callback` for each valid file entry (skips volume labels, LFN, deleted).
// `user_data` is passed through to the callback.
// Returns total number of file entries found.
int fat12_list_files(void (*callback)(const struct Fat12Entry *entry, void *user_data),
                     void *user_data);

// Read a file into `buf` by following its cluster chain.
// `first_cluster` and `size` come from Fat12Entry.
// `buf` must be large enough to hold `size` bytes.
// Returns number of bytes actually read.
uint32_t fat12_read_file(uint16_t first_cluster, uint32_t size, uint8_t *buf);

#ifdef __cplusplus
}
#endif
