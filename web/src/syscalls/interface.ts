import type { VMState } from "../vm/vm.ts";

/**
 * A syscall handler is just a function: takes the syscall ID and the VM state,
 * reads args from the stack, pushes results back.
 */
export type SyscallHandler = (id: number, vm: VMState) => void;
