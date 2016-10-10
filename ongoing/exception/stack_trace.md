

## 一.概述

Throwable.java
StackTraceElement.java

## e,printStackTrace

### 1

    public void printStackTrace() {
        printStackTrace(System.err);
    }

### 2

    public void printStackTrace(PrintStream err) {
        try {
            printStackTrace(err, "", null);
        } catch (IOException e) {
            // Appendable.append throws IOException but PrintStream.append doesn't.
            throw new AssertionError();
        }
    }

### 3

    private void printStackTrace(Appendable err, String indent, StackTraceElement[] parentStack)
        throws IOException {
        err.append(toString());
        err.append("\n");

        StackTraceElement[] stack = getInternalStackTrace();
        if (stack != null) {
            int duplicates = parentStack != null ? countDuplicates(stack, parentStack) : 0;
            for (int i = 0; i < stack.length - duplicates; i++) {
                err.append(indent);
                err.append("\tat ");
                err.append(stack[i].toString());
                err.append("\n");
            }

            if (duplicates > 0) {
                err.append(indent);
                err.append("\t... ");
                err.append(Integer.toString(duplicates));
                err.append(" more\n");
            }
        }

        // Print suppressed exceptions indented one level deeper.
        if (suppressedExceptions != null) {
            for (Throwable throwable : suppressedExceptions) {
                err.append(indent);
                err.append("\tSuppressed: ");
                throwable.printStackTrace(err, indent + "\t", stack);
            }
        }

        Throwable cause = getCause();
        if (cause != null) {
            err.append(indent);
            err.append("Caused by: ");
            cause.printStackTrace(err, indent, stack);
        }
    }

### getInternalStackTrace

    private StackTraceElement[] getInternalStackTrace() {
        if (stackTrace == EmptyArray.STACK_TRACE_ELEMENT) {
            stackTrace = nativeGetStackTrace(stackState);
            stackState = null; // Let go of intermediate representation.
            return stackTrace;
        } else if (stackTrace == null) {
            return EmptyArray.STACK_TRACE_ELEMENT;
        } else {
          return stackTrace;
        }
    }
