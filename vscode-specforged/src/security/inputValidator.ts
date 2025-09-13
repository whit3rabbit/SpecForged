/**
 * Input validation utilities for the VS Code extension.
 *
 * Provides client-side validation before sending operations to MCP server.
 * Acts as the first line of defense against malicious input.
 */

export interface ValidationError {
    field: string;
    message: string;
    code: string;
    severity: 'error' | 'warning';
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    sanitizedData?: any;
}

export class InputValidator {
    // Security patterns for injection detection
    private static readonly INJECTION_PATTERNS = {
        sql_injection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND)\b)|(--|\/\*|\*\/|'|"|\||;)/i,
        xss_injection: /(<script[^>]*>|<\/script>|javascript:|on\w+\s*=|<iframe|<object|<embed|<form)/i,
        path_traversal: /(\.\.[\\/]|[\\/]\.\.[\\/]|[\\/]\.\.|^\.\.[\\/])/,
        command_injection: /[;&|`$\(\){}]|(\b(eval|exec|system|shell_exec|passthru)\b)/i,
    };

    // Common validation patterns
    private static readonly SPEC_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
    private static readonly TASK_NUMBER_PATTERN = /^\d+(\.\d+)*$/;

    // Size limits
    private static readonly MAX_CONTENT_SIZE = 1024 * 1024; // 1MB
    private static readonly MAX_DESCRIPTION_SIZE = 10 * 1024; // 10KB
    private static readonly MAX_NAME_SIZE = 1024; // 1KB

    /**
     * Validate MCP operation parameters before sending to server.
     */
    static validateOperationParams(operationType: string, params: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        try {
            // Basic parameter validation
            if (!params || typeof params !== 'object') {
                errors.push({
                    field: 'params',
                    message: 'Parameters must be a valid object',
                    code: 'INVALID_PARAMS',
                    severity: 'error'
                });
                return { valid: false, errors, warnings };
            }

            // Operation-specific validation
            switch (operationType) {
                case 'create_spec':
                    return this.validateCreateSpecParams(params);
                case 'update_requirements':
                case 'update_design':
                case 'update_tasks':
                    return this.validateUpdateContentParams(params);
                case 'add_user_story':
                    return this.validateAddUserStoryParams(params);
                case 'update_task_status':
                    return this.validateUpdateTaskStatusParams(params);
                case 'delete_spec':
                case 'set_current_spec':
                    return this.validateSpecIdParams(params);
                default:
                    warnings.push({
                        field: 'operationType',
                        message: `Unknown operation type: ${operationType}`,
                        code: 'UNKNOWN_OPERATION',
                        severity: 'warning'
                    });
            }

            return { valid: errors.length === 0, errors, warnings };

        } catch (error) {
            errors.push({
                field: 'validation',
                message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: 'VALIDATION_ERROR',
                severity: 'error'
            });
            return { valid: false, errors, warnings };
        }
    }

    private static validateCreateSpecParams(params: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];
        const sanitizedData: any = {};

        // Validate name (required)
        if (!params.name || typeof params.name !== 'string') {
            errors.push({
                field: 'name',
                message: 'Specification name is required and must be a string',
                code: 'MISSING_NAME',
                severity: 'error'
            });
        } else {
            const trimmedName = params.name.trim();
            if (!trimmedName) {
                errors.push({
                    field: 'name',
                    message: 'Specification name cannot be empty',
                    code: 'EMPTY_NAME',
                    severity: 'error'
                });
            } else if (this.getByteLength(trimmedName) > this.MAX_NAME_SIZE) {
                errors.push({
                    field: 'name',
                    message: `Name exceeds maximum size of ${this.MAX_NAME_SIZE} bytes`,
                    code: 'NAME_TOO_LONG',
                    severity: 'error'
                });
            } else {
                // Check for injection patterns
                const injectionCheck = this.checkForInjectionPatterns(trimmedName, 'name');
                errors.push(...injectionCheck.errors);
                warnings.push(...injectionCheck.warnings);

                if (injectionCheck.errors.length === 0) {
                    sanitizedData.name = this.sanitizeString(trimmedName);
                }
            }
        }

        // Validate description (optional)
        if (params.description !== undefined) {
            if (typeof params.description !== 'string') {
                errors.push({
                    field: 'description',
                    message: 'Description must be a string',
                    code: 'INVALID_DESCRIPTION_TYPE',
                    severity: 'error'
                });
            } else if (this.getByteLength(params.description) > this.MAX_DESCRIPTION_SIZE) {
                errors.push({
                    field: 'description',
                    message: `Description exceeds maximum size of ${this.MAX_DESCRIPTION_SIZE} bytes`,
                    code: 'DESCRIPTION_TOO_LONG',
                    severity: 'error'
                });
            } else {
                const injectionCheck = this.checkForInjectionPatterns(params.description, 'description');
                errors.push(...injectionCheck.errors);
                warnings.push(...injectionCheck.warnings);

                if (injectionCheck.errors.length === 0) {
                    sanitizedData.description = this.sanitizeString(params.description.trim());
                }
            }
        }

        // Validate spec_id (optional)
        if (params.spec_id !== undefined) {
            const specIdValidation = this.validateSpecId(params.spec_id);
            errors.push(...specIdValidation.errors);
            warnings.push(...specIdValidation.warnings);

            if (specIdValidation.valid && specIdValidation.sanitizedData) {
                sanitizedData.spec_id = specIdValidation.sanitizedData.spec_id;
            }
        }

        return { valid: errors.length === 0, errors, warnings, sanitizedData };
    }

    private static validateUpdateContentParams(params: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];
        const sanitizedData: any = {};

        // Validate spec_id (required)
        const specIdValidation = this.validateSpecId(params.spec_id, true);
        errors.push(...specIdValidation.errors);
        warnings.push(...specIdValidation.warnings);

        if (specIdValidation.sanitizedData) {
            sanitizedData.spec_id = specIdValidation.sanitizedData.spec_id;
        }

        // Validate content (required)
        if (!params.content || typeof params.content !== 'string') {
            errors.push({
                field: 'content',
                message: 'Content is required and must be a string',
                code: 'MISSING_CONTENT',
                severity: 'error'
            });
        } else if (this.getByteLength(params.content) > this.MAX_CONTENT_SIZE) {
            errors.push({
                field: 'content',
                message: `Content exceeds maximum size of ${this.MAX_CONTENT_SIZE} bytes`,
                code: 'CONTENT_TOO_LARGE',
                severity: 'error'
            });
        } else {
            // Check for injection patterns
            const injectionCheck = this.checkForInjectionPatterns(params.content, 'content');
            errors.push(...injectionCheck.errors);
            warnings.push(...injectionCheck.warnings);

            if (injectionCheck.errors.length === 0) {
                sanitizedData.content = params.content.trim();

                // Warn about large content
                if (this.getByteLength(params.content) > 50 * 1024) {
                    warnings.push({
                        field: 'content',
                        message: 'Large content size may impact performance',
                        code: 'LARGE_CONTENT',
                        severity: 'warning'
                    });
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings, sanitizedData };
    }

    private static validateAddUserStoryParams(params: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];
        const sanitizedData: any = {};

        // Validate spec_id
        const specIdValidation = this.validateSpecId(params.spec_id, true);
        errors.push(...specIdValidation.errors);
        warnings.push(...specIdValidation.warnings);

        if (specIdValidation.sanitizedData) {
            sanitizedData.spec_id = specIdValidation.sanitizedData.spec_id;
        }

        // Validate user story components
        const requiredFields = ['as_a', 'i_want', 'so_that'];
        for (const field of requiredFields) {
            const value = params[field];
            if (!value || typeof value !== 'string') {
                errors.push({
                    field,
                    message: `${field} is required and must be a string`,
                    code: `MISSING_${field.toUpperCase()}`,
                    severity: 'error'
                });
            } else {
                const trimmedValue = value.trim();
                if (!trimmedValue) {
                    errors.push({
                        field,
                        message: `${field} cannot be empty`,
                        code: `EMPTY_${field.toUpperCase()}`,
                        severity: 'error'
                    });
                } else if (this.getByteLength(trimmedValue) > this.MAX_DESCRIPTION_SIZE) {
                    errors.push({
                        field,
                        message: `${field} exceeds maximum size`,
                        code: `${field.toUpperCase()}_TOO_LONG`,
                        severity: 'error'
                    });
                } else {
                    const injectionCheck = this.checkForInjectionPatterns(trimmedValue, field);
                    errors.push(...injectionCheck.errors);
                    warnings.push(...injectionCheck.warnings);

                    if (injectionCheck.errors.length === 0) {
                        sanitizedData[field] = this.sanitizeString(trimmedValue);
                    }
                }
            }
        }

        // Validate EARS requirements (optional)
        if (params.ears_requirements !== undefined) {
            if (!Array.isArray(params.ears_requirements)) {
                errors.push({
                    field: 'ears_requirements',
                    message: 'EARS requirements must be an array',
                    code: 'INVALID_EARS_TYPE',
                    severity: 'error'
                });
            } else {
                const sanitizedRequirements: any[] = [];
                params.ears_requirements.forEach((req: any, index: number) => {
                    if (!req || typeof req !== 'object') {
                        errors.push({
                            field: `ears_requirements[${index}]`,
                            message: `Requirement ${index + 1} must be an object`,
                            code: 'INVALID_REQUIREMENT',
                            severity: 'error'
                        });
                        return;
                    }

                    const sanitizedReq: any = {};
                    ['condition', 'system_response'].forEach(reqField => {
                        const reqValue = req[reqField];
                        if (!reqValue || typeof reqValue !== 'string') {
                            errors.push({
                                field: `ears_requirements[${index}].${reqField}`,
                                message: `Requirement ${index + 1} ${reqField} is required and must be a string`,
                                code: `MISSING_REQ_${reqField.toUpperCase()}`,
                                severity: 'error'
                            });
                        } else {
                            const trimmedReqValue = reqValue.trim();
                            if (!trimmedReqValue) {
                                errors.push({
                                    field: `ears_requirements[${index}].${reqField}`,
                                    message: `Requirement ${index + 1} ${reqField} cannot be empty`,
                                    code: `EMPTY_REQ_${reqField.toUpperCase()}`,
                                    severity: 'error'
                                });
                            } else {
                                const injectionCheck = this.checkForInjectionPatterns(
                                    trimmedReqValue,
                                    `ears_requirements[${index}].${reqField}`
                                );
                                errors.push(...injectionCheck.errors);
                                warnings.push(...injectionCheck.warnings);

                                if (injectionCheck.errors.length === 0) {
                                    sanitizedReq[reqField] = this.sanitizeString(trimmedReqValue);
                                }
                            }
                        }
                    });

                    if (Object.keys(sanitizedReq).length === 2) {
                        sanitizedRequirements.push(sanitizedReq);
                    }
                });

                if (sanitizedRequirements.length > 0) {
                    sanitizedData.ears_requirements = sanitizedRequirements;
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings, sanitizedData };
    }

    private static validateUpdateTaskStatusParams(params: any): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];
        const sanitizedData: any = {};

        // Validate spec_id
        const specIdValidation = this.validateSpecId(params.spec_id, true);
        errors.push(...specIdValidation.errors);
        warnings.push(...specIdValidation.warnings);

        if (specIdValidation.sanitizedData) {
            sanitizedData.spec_id = specIdValidation.sanitizedData.spec_id;
        }

        // Validate task_number
        if (!params.task_number || typeof params.task_number !== 'string') {
            errors.push({
                field: 'task_number',
                message: 'Task number is required and must be a string',
                code: 'MISSING_TASK_NUMBER',
                severity: 'error'
            });
        } else if (!this.TASK_NUMBER_PATTERN.test(params.task_number)) {
            errors.push({
                field: 'task_number',
                message: 'Task number must be in format "1", "1.1", "1.2.3", etc.',
                code: 'INVALID_TASK_NUMBER_FORMAT',
                severity: 'error'
            });
        } else {
            sanitizedData.task_number = params.task_number;
        }

        // Validate status
        const allowedStatuses = ['pending', 'in_progress', 'completed'];
        if (!allowedStatuses.includes(params.status)) {
            errors.push({
                field: 'status',
                message: `Status must be one of: ${allowedStatuses.join(', ')}`,
                code: 'INVALID_STATUS',
                severity: 'error'
            });
        } else {
            sanitizedData.status = params.status;
        }

        return { valid: errors.length === 0, errors, warnings, sanitizedData };
    }

    private static validateSpecIdParams(params: any): ValidationResult {
        const specIdValidation = this.validateSpecId(params.spec_id, true);
        return {
            valid: specIdValidation.valid,
            errors: specIdValidation.errors,
            warnings: specIdValidation.warnings,
            sanitizedData: specIdValidation.sanitizedData
        };
    }

    private static validateSpecId(specId: any, required: boolean = false): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];
        const sanitizedData: any = {};

        if (specId === undefined || specId === null) {
            if (required) {
                errors.push({
                    field: 'spec_id',
                    message: 'Spec ID is required',
                    code: 'MISSING_SPEC_ID',
                    severity: 'error'
                });
            }
            return { valid: !required, errors, warnings, sanitizedData };
        }

        if (typeof specId !== 'string') {
            errors.push({
                field: 'spec_id',
                message: 'Spec ID must be a string',
                code: 'INVALID_SPEC_ID_TYPE',
                severity: 'error'
            });
        } else if (!this.SPEC_ID_PATTERN.test(specId)) {
            errors.push({
                field: 'spec_id',
                message: 'Spec ID must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen',
                code: 'INVALID_SPEC_ID_FORMAT',
                severity: 'error'
            });
        } else if (specId.length > 50) {
            errors.push({
                field: 'spec_id',
                message: 'Spec ID cannot exceed 50 characters',
                code: 'SPEC_ID_TOO_LONG',
                severity: 'error'
            });
        } else {
            sanitizedData.spec_id = specId;
        }

        return { valid: errors.length === 0, errors, warnings, sanitizedData };
    }

    private static checkForInjectionPatterns(value: string, fieldName: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        for (const [patternName, pattern] of Object.entries(this.INJECTION_PATTERNS)) {
            if (pattern.test(value)) {
                errors.push({
                    field: fieldName,
                    message: `Input contains potentially dangerous content (${patternName})`,
                    code: `INJECTION_ATTEMPT_${patternName.toUpperCase()}`,
                    severity: 'error'
                });
                break; // Only report first match to avoid spam
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    private static sanitizeString(value: string): string {
        // Basic HTML escaping
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    private static getByteLength(str: string): number {
        return new TextEncoder().encode(str).length;
    }

    /**
     * Validate file paths to prevent directory traversal attacks.
     */
    static validateFilePath(filePath: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        if (!filePath || typeof filePath !== 'string') {
            errors.push({
                field: 'filePath',
                message: 'File path is required and must be a string',
                code: 'MISSING_FILE_PATH',
                severity: 'error'
            });
            return { valid: false, errors, warnings };
        }

        // Check for path traversal attempts
        const dangerousPatterns = [
            /\.\./,           // Parent directory
            /^\/|^[A-Z]:\\/,  // Absolute paths (Unix/Windows)
            /\0/,             // Null bytes
            /[\r\n]/,         // Newlines
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(filePath)) {
                errors.push({
                    field: 'filePath',
                    message: 'File path contains dangerous components',
                    code: 'DANGEROUS_FILE_PATH',
                    severity: 'error'
                });
                break;
            }
        }

        // Check length
        if (filePath.length > 260) { // Windows MAX_PATH limit
            warnings.push({
                field: 'filePath',
                message: 'File path is very long and may cause issues on some systems',
                code: 'LONG_FILE_PATH',
                severity: 'warning'
            });
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate JSON content safely.
     */
    static validateJsonContent(content: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        if (!content || typeof content !== 'string') {
            errors.push({
                field: 'content',
                message: 'JSON content is required and must be a string',
                code: 'MISSING_JSON_CONTENT',
                severity: 'error'
            });
            return { valid: false, errors, warnings };
        }

        try {
            const parsed = JSON.parse(content);

            // Check for deeply nested objects (DoS prevention)
            const maxDepth = 50;
            if (this.getObjectDepth(parsed) > maxDepth) {
                errors.push({
                    field: 'content',
                    message: `JSON structure exceeds maximum nesting depth of ${maxDepth}`,
                    code: 'JSON_TOO_DEEP',
                    severity: 'error'
                });
            }

            return { valid: errors.length === 0, errors, warnings, sanitizedData: parsed };

        } catch (error) {
            errors.push({
                field: 'content',
                message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
                code: 'INVALID_JSON',
                severity: 'error'
            });
            return { valid: false, errors, warnings };
        }
    }

    private static getObjectDepth(obj: any, currentDepth: number = 0): number {
        if (currentDepth > 100) {return currentDepth;} // Prevent infinite recursion

        if (obj === null || typeof obj !== 'object') {
            return currentDepth;
        }

        if (Array.isArray(obj)) {
            return obj.reduce((maxDepth, item) =>
                Math.max(maxDepth, this.getObjectDepth(item, currentDepth + 1)),
                currentDepth
            );
        }

        return Object.values(obj).reduce((maxDepth: number, value) =>
            Math.max(maxDepth, this.getObjectDepth(value, currentDepth + 1)),
            currentDepth
        );
    }
}
