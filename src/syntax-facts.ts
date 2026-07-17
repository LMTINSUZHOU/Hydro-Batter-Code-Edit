import type { Node, Tree } from 'web-tree-sitter';
import { normalizeLanguage } from './catalog';

export interface SyntaxMemberFact {
    name: string;
    kind: 'field' | 'method';
    owner: string;
    returnType?: string;
    parameters: string[];
    detail: string;
}

export interface SyntaxFunctionFact {
    name: string;
    returnType?: string;
    parameters: string[];
    detail: string;
    start: number;
    end: number;
}

export interface SyntaxVariableFact {
    name: string;
    type?: string;
    start: number;
    scopeStart: number;
    scopeEnd: number;
}

export interface SyntaxFacts {
    engine: 'tree-sitter';
    language: string;
    maskedCode: string;
    members: SyntaxMemberFact[];
    functions: SyntaxFunctionFact[];
    variables: SyntaxVariableFact[];
    errorCount: number;
}

interface PendingVariable extends SyntaxVariableFact {
    initializer?: Node;
    syntaxStart: number;
}

class ByteOffsetMap {
    private offsets: Uint32Array;

    constructor(code: string) {
        let byteLength = 0;
        for (let index = 0; index < code.length;) {
            const point = code.codePointAt(index)!;
            byteLength += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
            index += point > 0xffff ? 2 : 1;
        }
        this.offsets = new Uint32Array(byteLength + 1);
        let byteIndex = 0;
        for (let offset = 0; offset < code.length;) {
            const point = code.codePointAt(offset)!;
            const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
            for (let index = 0; index < bytes; index += 1) this.offsets[byteIndex + index] = offset;
            byteIndex += bytes;
            offset += point > 0xffff ? 2 : 1;
        }
        this.offsets[byteLength] = code.length;
    }

    offset(byteIndex: number): number {
        return this.offsets[Math.max(0, Math.min(byteIndex, this.offsets.length - 1))];
    }
}

function normalizeType(language: string, rawType?: string): string | undefined {
    if (!rawType) return undefined;
    const compact = rawType.trim().replace(/\s+/g, ' ');
    if (!compact || compact === 'auto' || compact === 'var') return undefined;
    if (language === 'cpp') {
        const value = compact.replace(/\b(?:const|volatile|typename|class|struct)\b/g, '')
            .replace(/std::/g, '').replace(/[&*\s]/g, '');
        const base = value.split('<')[0];
        if (base === 'basic_string' || base === 'string_view') return 'string';
        if (base === 'multiset') return 'set';
        if (base === 'multimap') return 'map';
        return base || undefined;
    }
    if (language === 'python') {
        const base = compact.split(/\[|\s|\|/)[0].split('.').at(-1)!;
        if (['List', 'Sequence', 'MutableSequence'].includes(base)) return 'list';
        if (['Dict', 'Mapping', 'MutableMapping'].includes(base)) return 'dict';
        if (['Set', 'AbstractSet'].includes(base)) return 'set';
        if (base === 'Tuple') return 'tuple';
        return base;
    }
    if (language === 'java') {
        if (compact.includes('[]')) return 'Array';
        const base = compact.replace(/<.*>/g, '').trim().split('.').at(-1)!;
        if (['ArrayList', 'LinkedList'].includes(base)) return 'List';
        if (base === 'PriorityQueue') return 'Queue';
        if (base === 'ArrayDeque') return 'Deque';
        if (['HashMap', 'LinkedHashMap', 'TreeMap'].includes(base)) return 'Map';
        if (['HashSet', 'TreeSet'].includes(base)) return 'Set';
        return base;
    }
    return compact;
}

function declaratorName(node: Node | null): string | undefined {
    if (!node) return undefined;
    if (['identifier', 'field_identifier'].includes(node.type)) return node.text;
    const named = node.childForFieldName('name') || node.childForFieldName('declarator');
    if (named && named.id !== node.id) return declaratorName(named);
    for (const child of node.namedChildren) {
        const result = declaratorName(child);
        if (result) return result;
    }
    return undefined;
}

function functionParts(node: Node, language: string) {
    if (language === 'cpp') {
        const declarator = node.childForFieldName('declarator');
        const callable = declarator?.type === 'function_declarator'
            ? declarator
            : declarator?.descendantsOfType('function_declarator')[0];
        return {
            name: declaratorName(callable?.childForFieldName('declarator') || null),
            parameters: callable?.childForFieldName('parameters') || null,
            returnType: normalizeType(language, node.childForFieldName('type')?.text),
        };
    }
    return {
        name: node.childForFieldName('name')?.text,
        parameters: node.childForFieldName('parameters'),
        returnType: normalizeType(language, node.childForFieldName('return_type')?.text
            || node.childForFieldName('type')?.text),
    };
}

function parameterFacts(node: Node | null, language: string): Array<{ name: string; type?: string }> {
    if (!node) return [];
    const types = language === 'cpp'
        ? ['parameter_declaration', 'optional_parameter_declaration']
        : language === 'python'
            ? ['identifier', 'typed_parameter', 'default_parameter', 'typed_default_parameter', 'list_splat', 'dictionary_splat']
            : ['formal_parameter', 'spread_parameter', 'receiver_parameter'];
    const parameters = node.namedChildren.filter((child) => types.includes(child.type));
    return parameters.map((parameter) => {
        if (language === 'python' && parameter.type === 'identifier') return { name: parameter.text };
        const nameNode = parameter.childForFieldName('name')
            || parameter.childForFieldName('declarator')
            || parameter.namedChildren.find((child) => child.type === 'identifier')
            || null;
        const typeNode = parameter.childForFieldName('type');
        return {
            name: declaratorName(nameNode) || parameter.text.replace(/^[*]+/, '').split(/[:=\s]/)[0],
            type: normalizeType(language, typeNode?.text),
        };
    }).filter((parameter) => parameter.name && !['self', 'cls'].includes(parameter.name));
}

function ownerClass(node: Node, language: string): Node | undefined {
    const classTypes = language === 'cpp'
        ? ['class_specifier', 'struct_specifier']
        : language === 'python'
            ? ['class_definition']
            : ['class_declaration', 'record_declaration', 'enum_declaration', 'interface_declaration'];
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (classTypes.includes(parent.type)) return parent;
    }
    return undefined;
}

function scopeFor(node: Node, byteMap: ByteOffsetMap): { start: number; end: number } {
    const scopes = new Set([
        'function_definition', 'lambda', 'method_declaration', 'constructor_declaration',
        'compact_constructor_declaration',
    ]);
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (scopes.has(parent.type)) {
            return { start: byteMap.offset(parent.startIndex), end: byteMap.offset(parent.endIndex) };
        }
    }
    const root = node.tree.rootNode;
    return { start: 0, end: byteMap.offset(root.endIndex) };
}

function memberReturnType(members: SyntaxMemberFact[], owner: string | undefined, name: string): string | undefined {
    if (!owner) return undefined;
    return members.find((member) => member.owner === owner && member.name === name)?.returnType;
}

function latestVariableType(variables: PendingVariable[], name: string, offset: number): string | undefined {
    return variables.filter((variable) => variable.name === name && variable.syntaxStart <= offset && variable.type)
        .sort((left, right) => right.syntaxStart - left.syntaxStart)[0]?.type;
}

function inferExpressionType(
    node: Node | null,
    language: string,
    variables: PendingVariable[],
    members: SyntaxMemberFact[],
    classes: Set<string>,
): string | undefined {
    if (!node) return undefined;
    if (['identifier', 'field_identifier', 'type_identifier'].includes(node.type)) {
        return latestVariableType(variables, node.text, node.startIndex) || (classes.has(node.text) ? node.text : undefined);
    }
    if (['string', 'string_literal', 'raw_string_literal', 'text_block'].includes(node.type)) {
        return language === 'python' ? 'str' : language === 'java' ? 'String' : 'string';
    }
    if (['list', 'list_comprehension'].includes(node.type)) return 'list';
    if (['dictionary', 'dictionary_comprehension'].includes(node.type)) return 'dict';
    if (['set', 'set_comprehension'].includes(node.type)) return 'set';
    if (['tuple', 'tuple_pattern'].includes(node.type)) return 'tuple';
    if (node.type === 'array_creation_expression') return 'Array';
    if (node.type === 'object_creation_expression') {
        return normalizeType(language, node.childForFieldName('type')?.text);
    }
    if (node.type === 'call') {
        const callable = node.childForFieldName('function');
        if (callable?.type === 'identifier') return normalizeType(language, callable.text);
        if (callable?.type === 'attribute') {
            const owner = inferExpressionType(callable.childForFieldName('object'), language, variables, members, classes);
            return memberReturnType(members, owner, callable.childForFieldName('attribute')?.text || '');
        }
    }
    if (node.type === 'call_expression') {
        const callable = node.childForFieldName('function');
        if (callable?.type === 'identifier' || callable?.type === 'type_identifier' || callable?.type === 'template_function') {
            return normalizeType(language, callable.text);
        }
        if (callable?.type === 'field_expression') {
            const owner = inferExpressionType(callable.childForFieldName('argument'), language, variables, members, classes);
            return memberReturnType(members, owner, callable.childForFieldName('field')?.text || '');
        }
    }
    if (node.type === 'method_invocation') {
        const owner = inferExpressionType(node.childForFieldName('object'), language, variables, members, classes);
        return memberReturnType(members, owner, node.childForFieldName('name')?.text || '');
    }
    if (['parenthesized_expression', 'cast_expression'].includes(node.type)) {
        return inferExpressionType(node.namedChildren.at(-1) || null, language, variables, members, classes);
    }
    return undefined;
}

function maskIgnoredNodes(tree: Tree, code: string, byteMap: ByteOffsetMap): string {
    const ignoredTypes = [
        'comment', 'line_comment', 'block_comment', 'string', 'string_literal', 'raw_string_literal',
        'concatenated_string', 'character_literal', 'char_literal', 'text_block',
    ];
    const characters = code.split('');
    for (const node of tree.rootNode.descendantsOfType(ignoredTypes)) {
        const start = byteMap.offset(node.startIndex);
        const end = byteMap.offset(node.endIndex);
        for (let index = start; index < end; index += 1) {
            if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' ';
        }
    }
    return characters.join('');
}

function collectFunctions(
    tree: Tree,
    language: string,
    byteMap: ByteOffsetMap,
    members: SyntaxMemberFact[],
    functions: SyntaxFunctionFact[],
    variables: PendingVariable[],
) {
    const functionTypes = language === 'cpp'
        ? ['function_definition']
        : language === 'python'
            ? ['function_definition']
            : ['method_declaration', 'constructor_declaration', 'compact_constructor_declaration'];
    for (const node of tree.rootNode.descendantsOfType(functionTypes)) {
        const parts = functionParts(node, language);
        if (!parts.name) continue;
        const parameters = parameterFacts(parts.parameters, language);
        const ownerNode = ownerClass(node, language);
        const owner = ownerNode?.childForFieldName('name')?.text;
        const detail = `${parts.returnType ? `${parts.returnType} ` : ''}${parts.name}(${parameters.map((item) => item.name).join(', ')})`;
        if (owner) {
            members.push({
                name: parts.name,
                kind: 'method',
                owner,
                returnType: parts.returnType || (parts.name === owner ? owner : undefined),
                parameters: parameters.map((item) => item.name),
                detail,
            });
        } else {
            functions.push({
                name: parts.name,
                returnType: parts.returnType,
                parameters: parameters.map((item) => item.name),
                detail,
                start: byteMap.offset(node.startIndex),
                end: byteMap.offset(node.endIndex),
            });
        }
        const scope = scopeFor(node, byteMap);
        for (const parameter of parameters) {
            variables.push({
                name: parameter.name,
                type: parameter.type,
                start: byteMap.offset(node.startIndex),
                syntaxStart: node.startIndex,
                scopeStart: scope.start,
                scopeEnd: scope.end,
            });
        }
    }
}

function collectClassFields(
    tree: Tree,
    language: string,
    members: SyntaxMemberFact[],
) {
    const classTypes = language === 'cpp'
        ? ['class_specifier', 'struct_specifier']
        : language === 'python'
            ? ['class_definition']
            : ['class_declaration', 'record_declaration'];
    for (const classNode of tree.rootNode.descendantsOfType(classTypes)) {
        const owner = classNode.childForFieldName('name')?.text;
        const body = classNode.childForFieldName('body');
        if (!owner || !body) continue;
        if (language === 'python') {
            for (const statement of body.namedChildren) {
                const assignment = statement.type === 'expression_statement' ? statement.firstNamedChild : statement;
                if (assignment?.type !== 'assignment') continue;
                const name = assignment.childForFieldName('left')?.text;
                if (!name || !/^[A-Za-z_]\w*$/.test(name)) continue;
                const returnType = normalizeType(language, assignment.childForFieldName('type')?.text)
                    || inferExpressionType(assignment.childForFieldName('right'), language, [], members, new Set());
                members.push({ name, kind: 'field', owner, returnType, parameters: [], detail: `${name}${returnType ? `: ${returnType}` : ''}` });
            }
            continue;
        }
        const fieldType = language === 'cpp' ? 'field_declaration' : 'field_declaration';
        for (const declaration of body.namedChildren.filter((child) => child.type === fieldType)) {
            const type = normalizeType(language, declaration.childForFieldName('type')?.text);
            for (const declarator of declaration.childrenForFieldName('declarator')) {
                const name = declaratorName(declarator);
                if (name) members.push({ name, kind: 'field', owner, returnType: type, parameters: [], detail: `${type || 'field'} ${name}` });
            }
        }
    }
}

function collectVariables(
    tree: Tree,
    language: string,
    byteMap: ByteOffsetMap,
    variables: PendingVariable[],
) {
    if (language === 'python') {
        for (const assignment of tree.rootNode.descendantsOfType('assignment')) {
            const owner = ownerClass(assignment, language);
            if (owner && !assignment.parent?.parent?.parent?.type.includes('function')) {
                // Class attributes are collected as members; method-local assignments continue below.
                let functionParent: Node | null = assignment.parent;
                while (functionParent && functionParent.id !== owner.id && functionParent.type !== 'function_definition') {
                    functionParent = functionParent.parent;
                }
                if (!functionParent || functionParent.id === owner.id) continue;
            }
            const left = assignment.childForFieldName('left');
            if (!left || left.type !== 'identifier') continue;
            const scope = scopeFor(assignment, byteMap);
            variables.push({
                name: left.text,
                type: normalizeType(language, assignment.childForFieldName('type')?.text),
                initializer: assignment.childForFieldName('right') || undefined,
                start: byteMap.offset(assignment.startIndex),
                syntaxStart: assignment.startIndex,
                scopeStart: scope.start,
                scopeEnd: scope.end,
            });
        }
        return;
    }
    const declarationTypes = language === 'cpp' ? ['declaration'] : ['local_variable_declaration', 'field_declaration'];
    for (const declaration of tree.rootNode.descendantsOfType(declarationTypes)) {
        const scope = scopeFor(declaration, byteMap);
        const explicitType = normalizeType(language, declaration.childForFieldName('type')?.text);
        for (const declarator of declaration.childrenForFieldName('declarator')) {
            if (declarator.type.includes('function')) continue;
            const name = declaratorName(declarator);
            if (!name) continue;
            const initializer = declarator.childForFieldName('value') || declarator.childForFieldName('default_value');
            variables.push({
                name,
                type: explicitType,
                initializer: initializer || undefined,
                start: byteMap.offset(declarator.startIndex),
                syntaxStart: declarator.startIndex,
                scopeStart: scope.start,
                scopeEnd: scope.end,
            });
        }
    }
}

export function extractSyntaxFacts(tree: Tree, code: string, language: string): SyntaxFacts {
    const normalized = normalizeLanguage(language);
    const byteMap = new ByteOffsetMap(code);
    const members: SyntaxMemberFact[] = [];
    const functions: SyntaxFunctionFact[] = [];
    const variables: PendingVariable[] = [];
    collectFunctions(tree, normalized, byteMap, members, functions, variables);
    collectClassFields(tree, normalized, members);
    collectVariables(tree, normalized, byteMap, variables);
    const classes = new Set(members.map((member) => member.owner));
    for (let pass = 0; pass < 3; pass += 1) {
        for (const variable of variables) {
            if (!variable.type) variable.type = inferExpressionType(variable.initializer || null, normalized, variables, members, classes);
        }
    }
    const uniqueMembers = new Map<string, SyntaxMemberFact>();
    for (const member of members) uniqueMembers.set(`${member.owner}:${member.kind}:${member.name}:${member.detail}`, member);
    const uniqueVariables = new Map<string, SyntaxVariableFact>();
    for (const { initializer: _initializer, syntaxStart: _syntaxStart, ...variable } of variables) {
        uniqueVariables.set(`${variable.scopeStart}:${variable.start}:${variable.name}`, variable);
    }
    return {
        engine: 'tree-sitter',
        language: normalized,
        maskedCode: maskIgnoredNodes(tree, code, byteMap),
        members: Array.from(uniqueMembers.values()),
        functions,
        variables: Array.from(uniqueVariables.values()),
        errorCount: tree.rootNode.descendantsOfType('ERROR').length,
    };
}
