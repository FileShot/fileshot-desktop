/*
  FileShot Drive (WinFsp) — minimal filesystem scaffold.

  Intent (phase 1): mount a real Windows volume and report quota-based
  total/free bytes so Explorer shows FileShot tier capacity correctly.

  NOTE: This is intentionally minimal (empty root, read-only). The goal is to
  validate the WinFsp plumbing + volume stats before layering in cloud mapping.

  Build strategy will be added later (CI + local build instructions).
*/

#define _CRT_SECURE_NO_WARNINGS

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#include <winfsp/winfsp.h>

#define PROGNAME L"fileshot-drive"

typedef struct _FS_CTX
{
    UINT64 TotalBytes;
    UINT64 FreeBytes;
    WCHAR VolumeLabel[32];
} FS_CTX;

typedef struct _FILE_CTX
{
    int IsRoot;
} FILE_CTX;

static int IsRootPath(PWSTR FileName)
{
    if (0 == FileName)
        return 1;

    /* WinFsp uses NT-style paths like "\\" or "\\foo". */
    if (0 == wcscmp(FileName, L"\\") || 0 == wcscmp(FileName, L""))
        return 1;

    /* Some callers may pass a single dot. */
    if (0 == wcscmp(FileName, L"\\.") || 0 == wcscmp(FileName, L"."))
        return 1;

    return 0;
}

static VOID FillRootDirInfo(FSP_FSCTL_FILE_INFO *FileInfo)
{
    memset(FileInfo, 0, sizeof(*FileInfo));
    FileInfo->FileAttributes = FILE_ATTRIBUTE_DIRECTORY;
    FileInfo->FileSize = 0;
    FileInfo->AllocationSize = 0;

    /* Use current time for timestamps (good enough for empty root v1). */
    FILETIME ft;
    GetSystemTimeAsFileTime(&ft);
    UINT64 t = ((UINT64)ft.dwHighDateTime << 32) | (UINT64)ft.dwLowDateTime;
    FileInfo->CreationTime = t;
    FileInfo->LastAccessTime = t;
    FileInfo->LastWriteTime = t;
    FileInfo->ChangeTime = t;

    FileInfo->IndexNumber = 1;
    FileInfo->HardLinks = 0;
}

static NTSTATUS GetVolumeInfo(FSP_FILE_SYSTEM *FileSystem, FSP_FSCTL_VOLUME_INFO *VolumeInfo)
{
    FS_CTX *Ctx = (FS_CTX *)FileSystem->UserContext;

    memset(VolumeInfo, 0, sizeof(*VolumeInfo));

    VolumeInfo->TotalSize = Ctx->TotalBytes;
    VolumeInfo->FreeSize = Ctx->FreeBytes;

    /* Volume label is optional. */
    wcsncpy_s(VolumeInfo->VolumeLabel, sizeof(VolumeInfo->VolumeLabel) / sizeof(WCHAR),
              Ctx->VolumeLabel, _TRUNCATE);

    return STATUS_SUCCESS;
}

static NTSTATUS SetVolumeLabel_(FSP_FILE_SYSTEM *FileSystem, PWSTR VolumeLabel, FSP_FSCTL_VOLUME_INFO *VolumeInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(VolumeLabel);
    UNREFERENCED_PARAMETER(VolumeInfo);

    /* Not supported in v1. */
    return STATUS_INVALID_DEVICE_REQUEST;
}

static NTSTATUS GetSecurityByName(
    FSP_FILE_SYSTEM *FileSystem,
    PWSTR FileName,
    PUINT32 PFileAttributes,
    PSECURITY_DESCRIPTOR SecurityDescriptor,
    SIZE_T *PSecurityDescriptorSize)
{
    UNREFERENCED_PARAMETER(SecurityDescriptor);

    if (!IsRootPath(FileName))
        return STATUS_OBJECT_NAME_NOT_FOUND;

    if (0 != PFileAttributes)
        *PFileAttributes = FILE_ATTRIBUTE_DIRECTORY;

    /* We do not implement ACLs; tell WinFsp that the security descriptor is empty. */
    if (0 != PSecurityDescriptorSize)
    {
        *PSecurityDescriptorSize = 0;
    }

    return STATUS_SUCCESS;
}

static NTSTATUS Create(
    FSP_FILE_SYSTEM *FileSystem,
    PWSTR FileName,
    UINT32 CreateOptions,
    UINT32 GrantedAccess,
    UINT32 FileAttributes,
    PSECURITY_DESCRIPTOR SecurityDescriptor,
    UINT64 AllocationSize,
    PVOID *PFileContext,
    FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileName);
    UNREFERENCED_PARAMETER(CreateOptions);
    UNREFERENCED_PARAMETER(GrantedAccess);
    UNREFERENCED_PARAMETER(FileAttributes);
    UNREFERENCED_PARAMETER(SecurityDescriptor);
    UNREFERENCED_PARAMETER(AllocationSize);
    UNREFERENCED_PARAMETER(PFileContext);
    UNREFERENCED_PARAMETER(FileInfo);

    /* Read-only empty filesystem for phase 1. */
    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS Open(
    FSP_FILE_SYSTEM *FileSystem,
    PWSTR FileName,
    UINT32 CreateOptions,
    UINT32 GrantedAccess,
    PVOID *PFileContext,
    FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(CreateOptions);
    UNREFERENCED_PARAMETER(GrantedAccess);

    if (!IsRootPath(FileName))
        return STATUS_OBJECT_NAME_NOT_FOUND;

    FILE_CTX *fc = (FILE_CTX *)malloc(sizeof(FILE_CTX));
    if (0 == fc)
        return STATUS_INSUFFICIENT_RESOURCES;

    fc->IsRoot = 1;
    *PFileContext = fc;

    FillRootDirInfo(FileInfo);
    return STATUS_SUCCESS;
}

static NTSTATUS Overwrite(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    UINT32 FileAttributes,
    BOOLEAN ReplaceFileAttributes,
    UINT64 AllocationSize,
    FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(FileAttributes);
    UNREFERENCED_PARAMETER(ReplaceFileAttributes);
    UNREFERENCED_PARAMETER(AllocationSize);
    UNREFERENCED_PARAMETER(FileInfo);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static VOID Cleanup(FSP_FILE_SYSTEM *FileSystem, PVOID FileContext, PWSTR FileName, ULONG Flags)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(FileName);
    UNREFERENCED_PARAMETER(Flags);
}

static VOID Close(FSP_FILE_SYSTEM *FileSystem, PVOID FileContext)
{
    UNREFERENCED_PARAMETER(FileSystem);

    if (0 != FileContext)
        free(FileContext);
}

static NTSTATUS Read(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    PVOID Buffer,
    UINT64 Offset,
    ULONG Length,
    PULONG PBytesTransferred)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(Buffer);
    UNREFERENCED_PARAMETER(Offset);
    UNREFERENCED_PARAMETER(Length);

    *PBytesTransferred = 0;
    return STATUS_END_OF_FILE;
}

static NTSTATUS Write(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    PVOID Buffer,
    UINT64 Offset,
    ULONG Length,
    BOOLEAN WriteToEndOfFile,
    BOOLEAN ConstrainedIo,
    PULONG PBytesTransferred,
    FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(Buffer);
    UNREFERENCED_PARAMETER(Offset);
    UNREFERENCED_PARAMETER(Length);
    UNREFERENCED_PARAMETER(WriteToEndOfFile);
    UNREFERENCED_PARAMETER(ConstrainedIo);
    UNREFERENCED_PARAMETER(PBytesTransferred);
    UNREFERENCED_PARAMETER(FileInfo);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS Flush(FSP_FILE_SYSTEM *FileSystem, PVOID FileContext, FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(FileInfo);

    return STATUS_SUCCESS;
}

static NTSTATUS GetFileInfo(FSP_FILE_SYSTEM *FileSystem, PVOID FileContext, FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);

    FILE_CTX *fc = (FILE_CTX *)FileContext;
    if (0 == fc || 0 == fc->IsRoot)
        return STATUS_INVALID_HANDLE;

    FillRootDirInfo(FileInfo);
    return STATUS_SUCCESS;
}

static NTSTATUS SetBasicInfo(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    UINT32 FileAttributes,
    UINT64 CreationTime,
    UINT64 LastAccessTime,
    UINT64 LastWriteTime,
    UINT64 ChangeTime,
    FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(FileAttributes);
    UNREFERENCED_PARAMETER(CreationTime);
    UNREFERENCED_PARAMETER(LastAccessTime);
    UNREFERENCED_PARAMETER(LastWriteTime);
    UNREFERENCED_PARAMETER(ChangeTime);
    UNREFERENCED_PARAMETER(FileInfo);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS SetFileSize(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    UINT64 NewSize,
    BOOLEAN SetAllocationSize,
    FSP_FSCTL_FILE_INFO *FileInfo)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(NewSize);
    UNREFERENCED_PARAMETER(SetAllocationSize);
    UNREFERENCED_PARAMETER(FileInfo);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS CanDelete(FSP_FILE_SYSTEM *FileSystem, PVOID FileContext, PWSTR FileName)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(FileName);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS Rename(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    PWSTR FileName,
    PWSTR NewFileName,
    BOOLEAN ReplaceIfExists)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(FileName);
    UNREFERENCED_PARAMETER(NewFileName);
    UNREFERENCED_PARAMETER(ReplaceIfExists);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS GetSecurity(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    PSECURITY_DESCRIPTOR SecurityDescriptor,
    SIZE_T *PSecurityDescriptorSize)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(SecurityDescriptor);

    if (0 != PSecurityDescriptorSize)
        *PSecurityDescriptorSize = 0;

    return STATUS_SUCCESS;
}

static NTSTATUS SetSecurity(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    SECURITY_INFORMATION SecurityInformation,
    PSECURITY_DESCRIPTOR ModificationDescriptor)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(FileContext);
    UNREFERENCED_PARAMETER(SecurityInformation);
    UNREFERENCED_PARAMETER(ModificationDescriptor);

    return STATUS_MEDIA_WRITE_PROTECTED;
}

static NTSTATUS ReadDirectory(
    FSP_FILE_SYSTEM *FileSystem,
    PVOID FileContext,
    PWSTR Pattern,
    PWSTR Marker,
    PVOID Buffer,
    ULONG BufferLength,
    PULONG PBytesTransferred)
{
    UNREFERENCED_PARAMETER(FileSystem);
    UNREFERENCED_PARAMETER(Pattern);
    UNREFERENCED_PARAMETER(Marker);
    UNREFERENCED_PARAMETER(Buffer);
    UNREFERENCED_PARAMETER(BufferLength);

    FILE_CTX *fc = (FILE_CTX *)FileContext;
    if (0 == fc || 0 == fc->IsRoot)
        return STATUS_INVALID_HANDLE;

    /* Empty directory (phase 1). */
    *PBytesTransferred = 0;
    return STATUS_SUCCESS;
}

static FSP_FILE_SYSTEM_INTERFACE FSInterface =
{
    GetVolumeInfo,
    SetVolumeLabel_,
    GetSecurityByName,
    Create,
    Open,
    Overwrite,
    Cleanup,
    Close,
    Read,
    Write,
    Flush,
    GetFileInfo,
    SetBasicInfo,
    SetFileSize,
    CanDelete,
    Rename,
    0, /* GetFileInfoByName (optional) */
    GetSecurity,
    SetSecurity,
    ReadDirectory,
    0, /* ResolveReparsePoints */
    0, /* GetReparsePoint */
    0, /* SetReparsePoint */
    0, /* DeleteReparsePoint */
    0, /* GetStreamInfo */
    0, /* GetDirInfoByName */
    0, /* Control */
};

static UINT64 ParseUint64(PWSTR s, UINT64 def)
{
    if (0 == s || 0 == *s)
        return def;

    wchar_t *end = 0;
    unsigned __int64 v = _wcstoui64(s, &end, 10);
    if (end == s)
        return def;

    return (UINT64)v;
}

static VOID Usage(VOID)
{
    fwprintf(stderr, L"%s usage:\n", PROGNAME);
    fwprintf(stderr, L"  %s -m X: [--total-bytes N] [--free-bytes N] [--label FileShot]\n", PROGNAME);
}

static NTSTATUS SvcStart(FSP_SERVICE *Service, ULONG argc, PWSTR *argv)
{
    UNREFERENCED_PARAMETER(Service);

    PWSTR MountPoint = 0;
    UINT64 totalBytes = 50ULL * 1024ULL * 1024ULL * 1024ULL;
    UINT64 freeBytes = 50ULL * 1024ULL * 1024ULL * 1024ULL;
    WCHAR label[32];
    wcscpy_s(label, 32, L"FileShot");

    for (ULONG i = 1; i < argc; i++)
    {
        if (0 == wcscmp(argv[i], L"-m") && i + 1 < argc)
        {
            MountPoint = argv[++i];
            continue;
        }
        if (0 == wcscmp(argv[i], L"--total-bytes") && i + 1 < argc)
        {
            totalBytes = ParseUint64(argv[++i], totalBytes);
            continue;
        }
        if (0 == wcscmp(argv[i], L"--free-bytes") && i + 1 < argc)
        {
            freeBytes = ParseUint64(argv[++i], freeBytes);
            continue;
        }
        if (0 == wcscmp(argv[i], L"--label") && i + 1 < argc)
        {
            wcsncpy_s(label, 32, argv[++i], _TRUNCATE);
            continue;
        }

        Usage();
        return STATUS_INVALID_PARAMETER;
    }

    if (0 == MountPoint)
    {
        Usage();
        return STATUS_INVALID_PARAMETER;
    }

    if (!NT_SUCCESS(FspLoad(0)))
        return STATUS_DLL_NOT_FOUND;

    FS_CTX *Ctx = (FS_CTX *)malloc(sizeof(FS_CTX));
    if (0 == Ctx)
        return STATUS_INSUFFICIENT_RESOURCES;

    memset(Ctx, 0, sizeof(*Ctx));
    Ctx->TotalBytes = totalBytes;
    Ctx->FreeBytes = freeBytes;
    wcsncpy_s(Ctx->VolumeLabel, sizeof(Ctx->VolumeLabel) / sizeof(WCHAR), label, _TRUNCATE);

    FSP_FSCTL_VOLUME_PARAMS VolumeParams;
    memset(&VolumeParams, 0, sizeof(VolumeParams));

    /* Minimal volume params. */
    VolumeParams.SectorSize = 4096;
    VolumeParams.SectorsPerAllocationUnit = 1;
    VolumeParams.MaxComponentLength = 255;
    VolumeParams.FileInfoTimeout = 1000;
    VolumeParams.CaseSensitiveSearch = 0;
    VolumeParams.CasePreservedNames = 1;
    VolumeParams.UnicodeOnDisk = 1;
    VolumeParams.PersistentAcls = 0;

    wcscpy_s(VolumeParams.FileSystemName, sizeof(VolumeParams.FileSystemName) / sizeof(WCHAR), L"FileShot");

    FSP_FILE_SYSTEM *FileSystem = 0;

    NTSTATUS Result = FspFileSystemCreate(
        L"" FSP_FSCTL_DISK_DEVICE_NAME,
        &VolumeParams,
        &FSInterface,
        &FileSystem);

    if (!NT_SUCCESS(Result))
    {
        free(Ctx);
        return Result;
    }

    FileSystem->UserContext = Ctx;

    Result = FspFileSystemSetMountPoint(FileSystem, MountPoint);
    if (!NT_SUCCESS(Result))
    {
        FspFileSystemDelete(FileSystem);
        free(Ctx);
        return Result;
    }

    Result = FspFileSystemStartDispatcher(FileSystem, 0);
    if (!NT_SUCCESS(Result))
    {
        FspFileSystemDelete(FileSystem);
        free(Ctx);
        return Result;
    }

    /* Store for stop. */
    Service->UserContext = FileSystem;

    return STATUS_SUCCESS;
}

static NTSTATUS SvcStop(FSP_SERVICE *Service)
{
    FSP_FILE_SYSTEM *FileSystem = (FSP_FILE_SYSTEM *)Service->UserContext;
    if (0 == FileSystem)
        return STATUS_SUCCESS;

    FS_CTX *Ctx = (FS_CTX *)FileSystem->UserContext;

    FspFileSystemStopDispatcher(FileSystem);
    FspFileSystemDelete(FileSystem);

    if (0 != Ctx)
        free(Ctx);

    Service->UserContext = 0;
    return STATUS_SUCCESS;
}

int wmain(int argc, wchar_t **argv)
{
    return FspServiceRun(PROGNAME, SvcStart, SvcStop, 0);
}
