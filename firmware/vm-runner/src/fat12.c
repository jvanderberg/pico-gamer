// Read-only FAT12 filesystem reader
//
// Reads directly from XIP flash — no sector buffering needed for reads.
// The FAT12 geometry is parsed from the BPB at init time.

#include "fat12.h"
#include "flash_store.h"
#include <string.h>
#include "hardware/flash.h"

// XIP base of the game partition
#define XIP_PARTITION_BASE (XIP_BASE + FLASH_PARTITION_OFFSET)

// Parsed BPB values (set by fat12_init)
static uint16_t bytes_per_sector;
static uint8_t  sectors_per_cluster;
static uint16_t reserved_sectors;
static uint8_t  num_fats;
static uint16_t root_entry_count;
static uint16_t total_sectors;
static uint16_t sectors_per_fat;

// Derived values
static uint32_t fat_start_byte;        // byte offset of FAT1 from partition start
static uint32_t root_dir_start_byte;   // byte offset of root directory
static uint32_t data_start_byte;       // byte offset of data area (cluster 2)
static uint32_t cluster_size_bytes;    // bytes per cluster

static bool initialized = false;

// Read a byte from the partition via XIP
static inline uint8_t part_read8(uint32_t offset) {
    return ((const uint8_t *)XIP_PARTITION_BASE)[offset];
}

// Read a 16-bit LE value from the partition
static inline uint16_t part_read16(uint32_t offset) {
    const uint8_t *p = (const uint8_t *)XIP_PARTITION_BASE + offset;
    return (uint16_t)(p[0] | (p[1] << 8));
}

// Read a 32-bit LE value from the partition
static inline uint32_t part_read32(uint32_t offset) {
    const uint8_t *p = (const uint8_t *)XIP_PARTITION_BASE + offset;
    return (uint32_t)(p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24));
}

// Get a FAT12 entry value for a given cluster number
static uint16_t fat12_get_entry(uint16_t cluster) {
    // FAT12: 3 bytes encode 2 entries
    uint32_t fat_offset = fat_start_byte + (cluster * 3 / 2);
    uint16_t val;

    if (cluster & 1) {
        // Odd cluster: high 12 bits of the 16-bit pair
        val = (uint16_t)((part_read8(fat_offset) >> 4) |
                         (part_read8(fat_offset + 1) << 4));
    } else {
        // Even cluster: low 12 bits of the 16-bit pair
        val = (uint16_t)((part_read8(fat_offset)) |
                         ((part_read8(fat_offset + 1) & 0x0F) << 8));
    }
    return val;
}

// Get byte offset of a data cluster
static uint32_t cluster_to_offset(uint16_t cluster) {
    return data_start_byte + (uint32_t)(cluster - 2) * cluster_size_bytes;
}

bool fat12_init(void) {
    // Check boot signature
    if (part_read8(510) != 0x55 || part_read8(511) != 0xAA) {
        initialized = false;
        return false;
    }

    bytes_per_sector    = part_read16(11);
    sectors_per_cluster = part_read8(13);
    reserved_sectors    = part_read16(14);
    num_fats            = part_read8(16);
    root_entry_count    = part_read16(17);
    total_sectors       = part_read16(19);
    sectors_per_fat     = part_read16(22);

    // Sanity checks
    if (bytes_per_sector != 512 || sectors_per_cluster == 0 || num_fats == 0) {
        initialized = false;
        return false;
    }

    fat_start_byte      = (uint32_t)reserved_sectors * bytes_per_sector;
    root_dir_start_byte = fat_start_byte + (uint32_t)num_fats * sectors_per_fat * bytes_per_sector;
    uint32_t root_dir_sectors = ((uint32_t)root_entry_count * 32 + bytes_per_sector - 1) / bytes_per_sector;
    data_start_byte     = root_dir_start_byte + root_dir_sectors * bytes_per_sector;
    cluster_size_bytes  = (uint32_t)sectors_per_cluster * bytes_per_sector;

    initialized = true;
    return true;
}

// Format an 8.3 name from a directory entry into a readable string
static void format_83_name(const uint8_t *raw, char *out) {
    int pos = 0;

    // Copy name (8 chars, trim trailing spaces)
    int name_end = 7;
    while (name_end >= 0 && raw[name_end] == ' ') name_end--;
    for (int i = 0; i <= name_end; i++) {
        out[pos++] = (char)raw[i];
    }

    // Copy extension (3 chars, trim trailing spaces)
    int ext_end = 10;
    while (ext_end >= 8 && raw[ext_end] == ' ') ext_end--;
    if (ext_end >= 8) {
        out[pos++] = '.';
        for (int i = 8; i <= ext_end; i++) {
            out[pos++] = (char)raw[i];
        }
    }

    out[pos] = '\0';
}

// Extract UCS-2 chars from an LFN entry into an ASCII buffer.
// LFN chars are at offsets: 1,3,5,7,9 (5 chars), 14,16,18,20,22,24 (6 chars), 28,30 (2 chars)
static void lfn_extract(uint32_t entry_offset, char *buf, int pos) {
    static const uint8_t lfn_offsets[] = {1,3,5,7,9, 14,16,18,20,22,24, 28,30};
    for (int j = 0; j < 13; j++) {
        int dst = pos + j;
        if (dst >= FAT12_MAX_LFN - 1) break;
        uint8_t lo = part_read8(entry_offset + lfn_offsets[j]);
        uint8_t hi = part_read8(entry_offset + lfn_offsets[j] + 1);
        if (lo == 0 && hi == 0) { buf[dst] = '\0'; return; }
        if (lo == 0xFF && hi == 0xFF) { buf[dst] = '\0'; return; }
        buf[dst] = (hi == 0) ? (char)lo : '?';  // ASCII or replacement
    }
}

int fat12_list_files(void (*callback)(const struct Fat12Entry *entry, void *user_data),
                     void *user_data) {
    if (!initialized) return 0;

    char lfn_buf[FAT12_MAX_LFN];
    lfn_buf[0] = '\0';

    int count = 0;
    for (int i = 0; i < root_entry_count; i++) {
        uint32_t entry_offset = root_dir_start_byte + (uint32_t)i * 32;
        uint8_t first_byte = part_read8(entry_offset);

        // 0x00 = end of directory
        if (first_byte == 0x00) break;
        // 0xE5 = deleted entry
        if (first_byte == 0xE5) { lfn_buf[0] = '\0'; continue; }

        uint8_t attr = part_read8(entry_offset + 11);

        // Collect LFN entries (they precede the 8.3 entry in reverse order)
        if (attr == 0x0F) {
            uint8_t seq = first_byte & 0x1F;  // sequence number (1-based)
            int pos = ((int)seq - 1) * 13;
            lfn_extract(entry_offset, lfn_buf, pos);
            // Null-terminate at the end if this is the last LFN entry
            if (first_byte & 0x40) {
                int end = pos + 13;
                if (end < FAT12_MAX_LFN) lfn_buf[end] = '\0';
            }
            continue;
        }

        // Skip volume labels, subdirectories
        if (attr & 0x08) { lfn_buf[0] = '\0'; continue; }
        if (attr & 0x10) { lfn_buf[0] = '\0'; continue; }

        struct Fat12Entry entry;
        uint8_t raw_name[11];
        for (int j = 0; j < 11; j++) {
            raw_name[j] = part_read8(entry_offset + j);
        }
        format_83_name(raw_name, entry.name);
        entry.attr          = attr;
        entry.first_cluster = part_read16(entry_offset + 26);
        entry.size          = part_read32(entry_offset + 28);

        // Copy LFN if available
        if (lfn_buf[0] != '\0') {
            strncpy(entry.long_name, lfn_buf, FAT12_MAX_LFN - 1);
            entry.long_name[FAT12_MAX_LFN - 1] = '\0';
        } else {
            entry.long_name[0] = '\0';
        }
        lfn_buf[0] = '\0';  // reset for next file

        if (callback) callback(&entry, user_data);
        count++;
    }

    return count;
}

uint32_t fat12_read_file(uint16_t first_cluster, uint32_t size, uint8_t *buf) {
    if (!initialized || size == 0) return 0;

    uint32_t bytes_read = 0;
    uint16_t cluster = first_cluster;

    while (bytes_read < size) {
        if (cluster < 2 || cluster >= 0xFF8) break;  // invalid or end-of-chain

        uint32_t offset = cluster_to_offset(cluster);
        uint32_t chunk = cluster_size_bytes;
        if (bytes_read + chunk > size) {
            chunk = size - bytes_read;
        }

        // Direct XIP copy from flash
        const uint8_t *src = (const uint8_t *)XIP_PARTITION_BASE + offset;
        memcpy(buf + bytes_read, src, chunk);
        bytes_read += chunk;

        // Follow chain
        cluster = fat12_get_entry(cluster);
    }

    return bytes_read;
}
