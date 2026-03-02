#pragma once
// Flash partition abstraction for game storage
//
// Partition: 0x00040000 – 0x00200000 (1,835,008 bytes = 3,584 × 512-byte sectors)
// Read path:  XIP memcpy (zero-copy)
// Write path: 4KB RMW cache, erase+program on block boundary change or flush

#include <stdint.h>
#include <stdbool.h>

#define FLASH_PARTITION_OFFSET  0x00040000          // offset from flash base
#define FLASH_PARTITION_SIZE    0x001C0000          // 1,835,008 bytes
#define FLASH_SECTOR_SIZE       512
#define FLASH_ERASE_SIZE        4096                // RP2040 flash erase block
#define FLASH_SECTORS_PER_BLOCK (FLASH_ERASE_SIZE / FLASH_SECTOR_SIZE)  // 8
#define FLASH_TOTAL_SECTORS     (FLASH_PARTITION_SIZE / FLASH_SECTOR_SIZE)  // 3584

#ifdef __cplusplus
extern "C" {
#endif

// Initialize the flash store (call once at boot)
void flash_store_init(void);

// Read sectors from the partition (XIP memcpy — fast, no flash operations)
void flash_store_read(uint32_t sector, uint8_t *buf, uint32_t count);

// Write sectors to the partition (uses 4KB RMW cache)
void flash_store_write(uint32_t sector, const uint8_t *buf, uint32_t count);

// Flush any pending writes in the cache to flash
void flash_store_flush(void);

// Check if the partition has a valid FAT12 BPB signature
bool flash_store_has_filesystem(void);

// Write the blank FAT12 image to format the partition
void flash_store_format(void);

#ifdef __cplusplus
}
#endif
