import { normalizeLanguage } from './catalog';
import type { SyntaxFacts } from './syntax-facts';

export type IdeCompletionKind =
    | 'class'
    | 'constant'
    | 'constructor'
    | 'enum'
    | 'field'
    | 'function'
    | 'interface'
    | 'method'
    | 'module'
    | 'property'
    | 'variable';

export interface IdeCompletionItem {
    label: string;
    insertText: string;
    detail: string;
    documentation?: string;
    kind: IdeCompletionKind;
    snippet?: boolean;
    parameters?: string[];
    returnType?: string;
    autoImport?: boolean;
    filterText?: string;
    sortText: string;
    replacement?: { start: number; end: number };
}

export interface CompletionAnalysis {
    language: string;
    variables: Map<string, string>;
    symbols: IdeCompletionItem[];
    scopedVariables: Array<{ name: string; type: string; start: number; scopeStart: number; scopeEnd: number }>;
    typeMembers: Map<string, MemberDefinition[]>;
    functionReturns: Map<string, string>;
    syntaxEngine: 'fallback' | 'tree-sitter';
}

export interface IdeCompletionResult {
    context: 'global' | 'include' | 'import' | 'member';
    exclusive: boolean;
    prefix: string;
    items: IdeCompletionItem[];
}

export interface IdeSignatureHelpResult {
    activeParameter: number;
    signatures: Array<{
        label: string;
        documentation?: string;
        parameters: Array<{ label: string; documentation?: string }>;
    }>;
}

interface MemberDefinition {
    label: string;
    detail: string;
    insertText?: string;
    kind?: 'field' | 'method' | 'property';
    documentation?: string;
    parameters?: string[];
    returnType?: string;
}

const CPP_HEADERS = [
    'algorithm', 'array', 'bitset', 'bits/stdc++.h', 'cassert', 'cmath', 'deque', 'functional',
    'iomanip', 'iostream', 'limits', 'list', 'map', 'numeric', 'queue', 'set', 'stack', 'string',
    'tuple', 'unordered_map', 'unordered_set', 'utility', 'vector',
];

const PYTHON_MODULES = [
    'bisect', 'collections', 'collections.Counter', 'collections.defaultdict', 'collections.deque',
    'functools', 'functools.lru_cache', 'heapq', 'itertools', 'math', 'operator', 'queue', 'random',
    'statistics', 'sys',
];

const JAVA_IMPORTS = [
    'java.io.*', 'java.io.BufferedReader', 'java.io.BufferedWriter', 'java.io.InputStreamReader',
    'java.io.PrintWriter', 'java.math.BigInteger', 'java.util.*', 'java.util.ArrayDeque',
    'java.util.ArrayList', 'java.util.Arrays', 'java.util.Collections', 'java.util.Comparator',
    'java.util.HashMap', 'java.util.HashSet', 'java.util.LinkedList', 'java.util.List',
    'java.util.Map', 'java.util.PriorityQueue', 'java.util.Queue', 'java.util.Scanner',
    'java.util.Set', 'java.util.StringTokenizer', 'java.util.TreeMap', 'java.util.TreeSet',
];

function method(
    label: string,
    parameters: string[],
    detail: string,
    documentation?: string,
    returnType?: string,
): MemberDefinition {
    const placeholders = parameters.map((parameter, index) => `\${${index + 1}:${parameter}}`);
    return {
        label,
        insertText: `${label}(${placeholders.join(', ')})`,
        detail,
        documentation,
        kind: 'method',
        parameters,
        returnType,
    };
}

function field(label: string, detail: string, documentation?: string): MemberDefinition {
    return { label, detail, documentation, kind: 'field', parameters: [] };
}

const SIZE_EMPTY_CLEAR = [
    method('size', [], 'size_type size() const', 'Returns the number of elements.'),
    method('empty', [], 'bool empty() const', 'Checks whether the container is empty.'),
    method('clear', [], 'void clear()', 'Removes all elements.'),
];

const CPP_SEQUENCE: MemberDefinition[] = [
    ...SIZE_EMPTY_CLEAR,
    method('push_back', ['value'], 'void push_back(const T& value)'),
    method('emplace_back', ['args'], 'T& emplace_back(Args&&... args)'),
    method('pop_back', [], 'void pop_back()'),
    method('front', [], 'T& front()'),
    method('back', [], 'T& back()'),
    method('begin', [], 'iterator begin()'),
    method('end', [], 'iterator end()'),
    method('insert', ['position', 'value'], 'iterator insert(iterator position, const T& value)'),
    method('erase', ['position'], 'iterator erase(iterator position)'),
];

const CPP_ASSOCIATIVE: MemberDefinition[] = [
    ...SIZE_EMPTY_CLEAR,
    method('insert', ['value'], 'iterator insert(const value_type& value)'),
    method('erase', ['key'], 'size_type erase(const key_type& key)'),
    method('find', ['key'], 'iterator find(const key_type& key)'),
    method('count', ['key'], 'size_type count(const key_type& key)'),
    method('contains', ['key'], 'bool contains(const key_type& key)', 'Available in C++20.'),
    method('begin', [], 'iterator begin()'),
    method('end', [], 'iterator end()'),
];

const CPP_MEMBERS: Record<string, MemberDefinition[]> = {
    vector: [
        ...CPP_SEQUENCE,
        method('at', ['index'], 'T& at(size_type index)'),
        method('data', [], 'T* data()'),
        method('reserve', ['capacity'], 'void reserve(size_type capacity)'),
        method('resize', ['size'], 'void resize(size_type size)'),
        method('capacity', [], 'size_type capacity() const'),
    ],
    array: [
        ...SIZE_EMPTY_CLEAR.filter((item) => item.label !== 'clear'),
        method('at', ['index'], 'T& at(size_type index)'),
        method('front', [], 'T& front()'),
        method('back', [], 'T& back()'),
        method('fill', ['value'], 'void fill(const T& value)'),
        method('begin', [], 'iterator begin()'),
        method('end', [], 'iterator end()'),
    ],
    deque: [
        ...CPP_SEQUENCE,
        method('push_front', ['value'], 'void push_front(const T& value)'),
        method('emplace_front', ['args'], 'T& emplace_front(Args&&... args)'),
        method('pop_front', [], 'void pop_front()'),
        method('at', ['index'], 'T& at(size_type index)'),
    ],
    list: [
        ...CPP_SEQUENCE,
        method('push_front', ['value'], 'void push_front(const T& value)'),
        method('pop_front', [], 'void pop_front()'),
        method('remove', ['value'], 'size_type remove(const T& value)'),
        method('sort', [], 'void sort()'),
        method('unique', [], 'size_type unique()'),
    ],
    string: [
        ...CPP_SEQUENCE,
        method('length', [], 'size_type length() const'),
        method('substr', ['position', 'count'], 'string substr(size_type position, size_type count = npos)'),
        method('find', ['value'], 'size_type find(const string& value) const'),
        method('rfind', ['value'], 'size_type rfind(const string& value) const'),
        method('compare', ['other'], 'int compare(const string& other) const'),
        method('c_str', [], 'const char* c_str() const'),
    ],
    queue: [
        ...SIZE_EMPTY_CLEAR.filter((item) => item.label !== 'clear'),
        method('front', [], 'T& front()'), method('back', [], 'T& back()'),
        method('push', ['value'], 'void push(const T& value)'),
        method('emplace', ['args'], 'void emplace(Args&&... args)'), method('pop', [], 'void pop()'),
    ],
    stack: [
        ...SIZE_EMPTY_CLEAR.filter((item) => item.label !== 'clear'),
        method('top', [], 'T& top()'), method('push', ['value'], 'void push(const T& value)'),
        method('emplace', ['args'], 'void emplace(Args&&... args)'), method('pop', [], 'void pop()'),
    ],
    priority_queue: [
        ...SIZE_EMPTY_CLEAR.filter((item) => item.label !== 'clear'),
        method('top', [], 'const T& top() const'), method('push', ['value'], 'void push(const T& value)'),
        method('emplace', ['args'], 'void emplace(Args&&... args)'), method('pop', [], 'void pop()'),
    ],
    set: CPP_ASSOCIATIVE,
    unordered_set: CPP_ASSOCIATIVE,
    map: [...CPP_ASSOCIATIVE, method('at', ['key'], 'mapped_type& at(const key_type& key)')],
    unordered_map: [...CPP_ASSOCIATIVE, method('at', ['key'], 'mapped_type& at(const key_type& key)')],
    pair: [field('first', 'T1 first'), field('second', 'T2 second')],
    std: [
        field('vector', 'std::vector<T>'), field('string', 'std::string'), field('queue', 'std::queue<T>'),
        field('priority_queue', 'std::priority_queue<T>'), field('map', 'std::map<K, V>'),
        method('sort', ['first', 'last'], 'void std::sort(RandomIt first, RandomIt last)'),
        method('lower_bound', ['first', 'last', 'value'], 'ForwardIt std::lower_bound(first, last, value)'),
        method('upper_bound', ['first', 'last', 'value'], 'ForwardIt std::upper_bound(first, last, value)'),
    ],
};

const PYTHON_MEMBERS: Record<string, MemberDefinition[]> = {
    list: [
        method('append', ['value'], 'list.append(value) -> None'),
        method('extend', ['iterable'], 'list.extend(iterable) -> None'),
        method('insert', ['index', 'value'], 'list.insert(index, value) -> None'),
        method('pop', ['index'], 'list.pop(index=-1) -> T'),
        method('remove', ['value'], 'list.remove(value) -> None'),
        method('sort', [], 'list.sort(*, key=None, reverse=False) -> None'),
        method('reverse', [], 'list.reverse() -> None'), method('clear', [], 'list.clear() -> None'),
        method('copy', [], 'list.copy() -> list'), method('count', ['value'], 'list.count(value) -> int'),
        method('index', ['value'], 'list.index(value) -> int'),
    ],
    str: [
        method('split', ['separator'], 'str.split(sep=None, maxsplit=-1) -> list[str]'),
        method('strip', [], 'str.strip(chars=None) -> str'), method('lstrip', [], 'str.lstrip(chars=None) -> str'),
        method('rstrip', [], 'str.rstrip(chars=None) -> str'),
        method('replace', ['old', 'new'], 'str.replace(old, new, count=-1) -> str'),
        method('find', ['substring'], 'str.find(substring) -> int'),
        method('index', ['substring'], 'str.index(substring) -> int'),
        method('count', ['substring'], 'str.count(substring) -> int'),
        method('startswith', ['prefix'], 'str.startswith(prefix) -> bool'),
        method('endswith', ['suffix'], 'str.endswith(suffix) -> bool'),
        method('join', ['iterable'], 'str.join(iterable) -> str'), method('lower', [], 'str.lower() -> str'),
        method('upper', [], 'str.upper() -> str'), method('isdigit', [], 'str.isdigit() -> bool'),
    ],
    dict: [
        method('get', ['key', 'default'], 'dict.get(key, default=None) -> V'),
        method('keys', [], 'dict.keys() -> dict_keys'), method('values', [], 'dict.values() -> dict_values'),
        method('items', [], 'dict.items() -> dict_items'), method('pop', ['key'], 'dict.pop(key) -> V'),
        method('popitem', [], 'dict.popitem() -> tuple[K, V]'),
        method('setdefault', ['key', 'default'], 'dict.setdefault(key, default=None) -> V'),
        method('update', ['other'], 'dict.update(other) -> None'), method('clear', [], 'dict.clear() -> None'),
        method('copy', [], 'dict.copy() -> dict'),
    ],
    set: [
        method('add', ['value'], 'set.add(value) -> None'), method('remove', ['value'], 'set.remove(value) -> None'),
        method('discard', ['value'], 'set.discard(value) -> None'), method('pop', [], 'set.pop() -> T'),
        method('union', ['other'], 'set.union(other) -> set'),
        method('intersection', ['other'], 'set.intersection(other) -> set'),
        method('difference', ['other'], 'set.difference(other) -> set'),
        method('issubset', ['other'], 'set.issubset(other) -> bool'),
        method('issuperset', ['other'], 'set.issuperset(other) -> bool'), method('clear', [], 'set.clear() -> None'),
    ],
    tuple: [
        method('count', ['value'], 'tuple.count(value) -> int'),
        method('index', ['value'], 'tuple.index(value) -> int'),
    ],
    deque: [
        method('append', ['value'], 'deque.append(value) -> None'),
        method('appendleft', ['value'], 'deque.appendleft(value) -> None'),
        method('pop', [], 'deque.pop() -> T'), method('popleft', [], 'deque.popleft() -> T'),
        method('extend', ['iterable'], 'deque.extend(iterable) -> None'),
        method('extendleft', ['iterable'], 'deque.extendleft(iterable) -> None'),
        method('rotate', ['steps'], 'deque.rotate(steps=1) -> None'), method('clear', [], 'deque.clear() -> None'),
    ],
    Counter: [
        method('most_common', ['count'], 'Counter.most_common(count=None) -> list[tuple[T, int]]'),
        method('elements', [], 'Counter.elements() -> iterator'),
        method('subtract', ['other'], 'Counter.subtract(other) -> None'),
        method('update', ['other'], 'Counter.update(other) -> None'),
    ],
    math: [
        method('sqrt', ['value'], 'math.sqrt(value) -> float'), method('gcd', ['a', 'b'], 'math.gcd(a, b) -> int'),
        method('lcm', ['a', 'b'], 'math.lcm(a, b) -> int'), method('ceil', ['value'], 'math.ceil(value) -> int'),
        method('floor', ['value'], 'math.floor(value) -> int'), method('isqrt', ['value'], 'math.isqrt(value) -> int'),
        method('log', ['value'], 'math.log(value, base=e) -> float'), field('pi', 'math.pi: float'),
        field('inf', 'math.inf: float'),
    ],
    heapq: [
        method('heappush', ['heap', 'value'], 'heapq.heappush(heap, value) -> None'),
        method('heappop', ['heap'], 'heapq.heappop(heap) -> T'),
        method('heapify', ['values'], 'heapq.heapify(values) -> None'),
        method('heappushpop', ['heap', 'value'], 'heapq.heappushpop(heap, value) -> T'),
        method('nlargest', ['count', 'iterable'], 'heapq.nlargest(count, iterable) -> list[T]'),
        method('nsmallest', ['count', 'iterable'], 'heapq.nsmallest(count, iterable) -> list[T]'),
    ],
    bisect: [
        method('bisect_left', ['values', 'value'], 'bisect.bisect_left(values, value) -> int'),
        method('bisect_right', ['values', 'value'], 'bisect.bisect_right(values, value) -> int'),
        method('insort_left', ['values', 'value'], 'bisect.insort_left(values, value) -> None'),
        method('insort_right', ['values', 'value'], 'bisect.insort_right(values, value) -> None'),
    ],
    sys: [field('stdin', 'sys.stdin'), field('stdout', 'sys.stdout'), field('maxsize', 'sys.maxsize: int'), method('setrecursionlimit', ['limit'], 'sys.setrecursionlimit(limit) -> None')],
};

const JAVA_COLLECTION: MemberDefinition[] = [
    method('add', ['value'], 'boolean add(E value)'), method('remove', ['value'], 'boolean remove(Object value)'),
    method('contains', ['value'], 'boolean contains(Object value)'), method('size', [], 'int size()'),
    method('isEmpty', [], 'boolean isEmpty()'), method('clear', [], 'void clear()'),
    method('iterator', [], 'Iterator<E> iterator()'),
];

const JAVA_QUEUE: MemberDefinition[] = [
    ...JAVA_COLLECTION,
    method('offer', ['value'], 'boolean offer(E value)'), method('poll', [], 'E poll()'),
    method('peek', [], 'E peek()'), method('element', [], 'E element()'),
];

const JAVA_MEMBERS: Record<string, MemberDefinition[]> = {
    Array: [field('length', 'final int length', 'The number of elements in this array.')],
    Collection: JAVA_COLLECTION,
    List: [
        ...JAVA_COLLECTION,
        method('add', ['index', 'value'], 'void add(int index, E value)'),
        method('get', ['index'], 'E get(int index)'), method('set', ['index', 'value'], 'E set(int index, E value)'),
        method('remove', ['index'], 'E remove(int index)'), method('indexOf', ['value'], 'int indexOf(Object value)'),
        method('sort', ['comparator'], 'void sort(Comparator<? super E> comparator)'),
    ],
    Queue: JAVA_QUEUE,
    Deque: [
        ...JAVA_QUEUE,
        method('offerFirst', ['value'], 'boolean offerFirst(E value)'),
        method('offerLast', ['value'], 'boolean offerLast(E value)'),
        method('pollFirst', [], 'E pollFirst()'), method('pollLast', [], 'E pollLast()'),
        method('peekFirst', [], 'E peekFirst()'), method('peekLast', [], 'E peekLast()'),
        method('push', ['value'], 'void push(E value)'), method('pop', [], 'E pop()'),
    ],
    Set: JAVA_COLLECTION,
    Map: [
        method('put', ['key', 'value'], 'V put(K key, V value)'),
        method('putIfAbsent', ['key', 'value'], 'V putIfAbsent(K key, V value)'),
        method('get', ['key'], 'V get(Object key)'),
        method('getOrDefault', ['key', 'defaultValue'], 'V getOrDefault(Object key, V defaultValue)'),
        method('containsKey', ['key'], 'boolean containsKey(Object key)'),
        method('containsValue', ['value'], 'boolean containsValue(Object value)'),
        method('remove', ['key'], 'V remove(Object key)'), method('keySet', [], 'Set<K> keySet()'),
        method('values', [], 'Collection<V> values()'), method('entrySet', [], 'Set<Map.Entry<K,V>> entrySet()'),
        method('size', [], 'int size()'), method('isEmpty', [], 'boolean isEmpty()'),
        method('clear', [], 'void clear()'),
        method('computeIfAbsent', ['key', 'mappingFunction'], 'V computeIfAbsent(K key, Function mappingFunction)'),
    ],
    String: [
        method('length', [], 'int length()'), method('charAt', ['index'], 'char charAt(int index)'),
        method('substring', ['beginIndex', 'endIndex'], 'String substring(int beginIndex, int endIndex)'),
        method('indexOf', ['value'], 'int indexOf(String value)'),
        method('lastIndexOf', ['value'], 'int lastIndexOf(String value)'),
        method('contains', ['value'], 'boolean contains(CharSequence value)'),
        method('startsWith', ['prefix'], 'boolean startsWith(String prefix)'),
        method('endsWith', ['suffix'], 'boolean endsWith(String suffix)'),
        method('split', ['regex'], 'String[] split(String regex)'),
        method('replace', ['target', 'replacement'], 'String replace(CharSequence target, CharSequence replacement)'),
        method('trim', [], 'String trim()'), method('toLowerCase', [], 'String toLowerCase()'),
        method('toUpperCase', [], 'String toUpperCase()'), method('compareTo', ['other'], 'int compareTo(String other)'),
        method('toCharArray', [], 'char[] toCharArray()'),
    ],
    StringBuilder: [
        method('append', ['value'], 'StringBuilder append(value)'),
        method('insert', ['offset', 'value'], 'StringBuilder insert(int offset, value)'),
        method('delete', ['start', 'end'], 'StringBuilder delete(int start, int end)'),
        method('deleteCharAt', ['index'], 'StringBuilder deleteCharAt(int index)'),
        method('reverse', [], 'StringBuilder reverse()'), method('length', [], 'int length()'),
        method('charAt', ['index'], 'char charAt(int index)'),
        method('setCharAt', ['index', 'value'], 'void setCharAt(int index, char value)'),
        method('toString', [], 'String toString()'),
    ],
    Scanner: [
        method('next', [], 'String next()'), method('nextInt', [], 'int nextInt()'),
        method('nextLong', [], 'long nextLong()'), method('nextDouble', [], 'double nextDouble()'),
        method('nextLine', [], 'String nextLine()'), method('hasNext', [], 'boolean hasNext()'),
        method('hasNextInt', [], 'boolean hasNextInt()'),
    ],
    BufferedReader: [method('readLine', [], 'String readLine() throws IOException'), method('close', [], 'void close()')],
    StringTokenizer: [
        method('nextToken', [], 'String nextToken()'), method('hasMoreTokens', [], 'boolean hasMoreTokens()'),
        method('countTokens', [], 'int countTokens()'),
    ],
    Arrays: [
        method('sort', ['array'], 'static void Arrays.sort(array)'),
        method('binarySearch', ['array', 'key'], 'static int Arrays.binarySearch(array, key)'),
        method('fill', ['array', 'value'], 'static void Arrays.fill(array, value)'),
        method('copyOf', ['array', 'newLength'], 'static T[] Arrays.copyOf(T[] array, int newLength)'),
        method('asList', ['values'], 'static List<T> Arrays.asList(T... values)'),
        method('equals', ['left', 'right'], 'static boolean Arrays.equals(left, right)'),
    ],
    Collections: [
        method('sort', ['list'], 'static void Collections.sort(List<T> list)'),
        method('reverse', ['list'], 'static void Collections.reverse(List<?> list)'),
        method('max', ['collection'], 'static T Collections.max(Collection<T> collection)'),
        method('min', ['collection'], 'static T Collections.min(Collection<T> collection)'),
        method('binarySearch', ['list', 'key'], 'static int Collections.binarySearch(List<T> list, T key)'),
        method('frequency', ['collection', 'value'], 'static int Collections.frequency(Collection<?> collection, Object value)'),
        method('swap', ['list', 'left', 'right'], 'static void Collections.swap(List<?> list, int left, int right)'),
    ],
    Math: [
        method('max', ['left', 'right'], 'static value Math.max(value left, value right)'),
        method('min', ['left', 'right'], 'static value Math.min(value left, value right)'),
        method('abs', ['value'], 'static value Math.abs(value)'), method('pow', ['base', 'exponent'], 'static double Math.pow(double base, double exponent)'),
        method('sqrt', ['value'], 'static double Math.sqrt(double value)'),
        method('ceil', ['value'], 'static double Math.ceil(double value)'),
        method('floor', ['value'], 'static double Math.floor(double value)'),
    ],
    Integer: [
        method('parseInt', ['value'], 'static int Integer.parseInt(String value)'),
        method('compare', ['left', 'right'], 'static int Integer.compare(int left, int right)'),
        field('MAX_VALUE', 'static final int Integer.MAX_VALUE'), field('MIN_VALUE', 'static final int Integer.MIN_VALUE'),
    ],
    Long: [method('parseLong', ['value'], 'static long Long.parseLong(String value)'), field('MAX_VALUE', 'static final long Long.MAX_VALUE')],
    'System.out': [method('print', ['value'], 'void System.out.print(value)'), method('println', ['value'], 'void System.out.println(value)'), method('printf', ['format', 'args'], 'PrintStream System.out.printf(String format, Object... args)')],
};

const MEMBER_RETURN_TYPES: Record<string, Record<string, Record<string, string>>> = {
    cpp: {
        string: { substr: 'string' },
    },
    python: {
        list: { copy: 'list' },
        str: {
            strip: 'str', lstrip: 'str', rstrip: 'str', replace: 'str', join: 'str', lower: 'str', upper: 'str',
            split: 'list',
        },
        dict: { copy: 'dict', keys: 'dict', values: 'dict', items: 'dict' },
        set: { union: 'set', intersection: 'set', difference: 'set' },
    },
    java: {
        String: {
            substring: 'String', replace: 'String', trim: 'String', toLowerCase: 'String',
            toUpperCase: 'String', split: 'Array', toCharArray: 'Array',
        },
        StringBuilder: {
            append: 'StringBuilder', insert: 'StringBuilder', delete: 'StringBuilder',
            deleteCharAt: 'StringBuilder', reverse: 'StringBuilder', toString: 'String',
        },
        Map: { keySet: 'Set', values: 'Collection', entrySet: 'Set' },
        Arrays: { copyOf: 'Array', asList: 'List' },
    },
};

const GLOBAL_CALLS: Record<string, MemberDefinition[]> = {
    cpp: [
        method('sort', ['first', 'last'], 'void sort(RandomIt first, RandomIt last)'),
        method('stable_sort', ['first', 'last'], 'void stable_sort(RandomIt first, RandomIt last)'),
        method('lower_bound', ['first', 'last', 'value'], 'ForwardIt lower_bound(first, last, value)'),
        method('upper_bound', ['first', 'last', 'value'], 'ForwardIt upper_bound(first, last, value)'),
        method('binary_search', ['first', 'last', 'value'], 'bool binary_search(first, last, value)'),
        method('accumulate', ['first', 'last', 'initial'], 'T accumulate(first, last, initial)'),
        method('gcd', ['left', 'right'], 'common_type gcd(left, right)'),
        method('min', ['left', 'right'], 'const T& min(const T& left, const T& right)'),
        method('max', ['left', 'right'], 'const T& max(const T& left, const T& right)'),
    ],
    python: [
        method('print', ['value'], 'print(*objects, sep=" ", end="\\n") -> None'),
        method('input', [], 'input(prompt="") -> str', undefined, 'str'), method('len', ['value'], 'len(value) -> int'),
        method('range', ['stop'], 'range(stop) / range(start, stop, step) -> range'),
        method('enumerate', ['iterable'], 'enumerate(iterable, start=0) -> enumerate'),
        method('zip', ['iterables'], 'zip(*iterables) -> zip'),
        method('sorted', ['iterable'], 'sorted(iterable, *, key=None, reverse=False) -> list', undefined, 'list'),
        method('sum', ['iterable'], 'sum(iterable, start=0) -> number'),
        method('min', ['iterable'], 'min(iterable) -> T'), method('max', ['iterable'], 'max(iterable) -> T'),
    ],
};

function completionMatchScore(label: string, query: string): number | undefined {
    if (!query) return 50;
    const lowerLabel = label.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (label === query) return 0;
    if (lowerLabel === lowerQuery) return 1;
    if (label.startsWith(query)) return 5;
    if (lowerLabel.startsWith(lowerQuery)) return 10;
    const capitals = label.replace(/[^A-Z0-9]/g, '').toLowerCase();
    if (capitals.startsWith(lowerQuery)) return 20;
    let queryIndex = 0;
    let gaps = 0;
    for (let index = 0; index < lowerLabel.length && queryIndex < lowerQuery.length; index += 1) {
        if (lowerLabel[index] === lowerQuery[queryIndex]) queryIndex += 1;
        else if (queryIndex) gaps += 1;
    }
    return queryIndex === lowerQuery.length ? 30 + gaps : undefined;
}

function normalizeCppType(type: string): string {
    const value = type.replace(/\b(?:const|volatile|typename)\b/g, '')
        .replace(/std::/g, '').replace(/[&*\s]/g, '');
    const base = value.split('<')[0];
    if (base === 'basic_string' || base === 'string_view') return 'string';
    if (base === 'multiset') return 'set';
    if (base === 'multimap') return 'map';
    return base;
}

function normalizeJavaType(type: string): string {
    const base = type.replace(/<.*>/g, '').replace(/\[\]/g, '').trim().split('.').pop() || type;
    if (['ArrayList', 'LinkedList'].includes(base)) return 'List';
    if (['PriorityQueue'].includes(base)) return 'Queue';
    if (['ArrayDeque'].includes(base)) return 'Deque';
    if (['HashMap', 'LinkedHashMap', 'TreeMap'].includes(base)) return 'Map';
    if (['HashSet', 'TreeSet'].includes(base)) return 'Set';
    return base;
}

function normalizeSemanticType(language: string, type: string): string {
    if (language === 'cpp') return normalizeCppType(type);
    if (language === 'java') return normalizeJavaType(type);
    if (language === 'python') return normalizePythonAnnotation(type) || type.split(/[\[|\s]/)[0];
    return type;
}

function symbolSnippet(name: string, parameters: string[]): string {
    return `${name}(${parameters.map((parameter, index) => `\${${index + 1}:${parameter}}`).join(', ')})`;
}

function parameterNames(parameters: string, language: string): string[] {
    if (!parameters.trim() || parameters.trim() === 'void') return [];
    return parameters.split(',').map((raw, index) => {
        const withoutDefault = raw.split('=')[0].trim();
        if (language === 'python') return withoutDefault.split(':')[0].replace(/^[*]+/, '').trim() || `arg${index + 1}`;
        const identifiers = withoutDefault.match(/[A-Za-z_$][\w$]*/g) || [];
        return identifiers.at(-1) || `arg${index + 1}`;
    });
}

function pushSymbol(target: IdeCompletionItem[], item: Omit<IdeCompletionItem, 'sortText'>) {
    target.push({ ...item, sortText: `00${item.label.toLowerCase()}` });
}

function analyzeCpp(code: string, analysis: CompletionAnalysis) {
    const knownTypes = 'vector|array|deque|list|string|string_view|queue|stack|priority_queue|set|multiset|unordered_set|map|multimap|unordered_map|pair';
    const declaration = new RegExp(`\\b(?:std::)?(${knownTypes})(?:\\s*<[^;\\n=(){}]+>)?\\s*[&*]?\\s+([A-Za-z_]\\w*)`, 'g');
    for (const match of code.matchAll(declaration)) {
        const type = normalizeCppType(match[1]);
        analysis.variables.set(match[2], type);
        pushSymbol(analysis.symbols, { label: match[2], insertText: match[2], detail: `${match[1]} ${match[2]}`, kind: 'variable' });
    }
    const inferredDeclaration = new RegExp(`\\bauto\\s+([A-Za-z_]\\w*)\\s*=\\s*(?:std::)?(${knownTypes})\\s*(?:<|\\()`, 'g');
    for (const match of code.matchAll(inferredDeclaration)) {
        const type = normalizeCppType(match[2]);
        analysis.variables.set(match[1], type);
        pushSymbol(analysis.symbols, { label: match[1], insertText: match[1], detail: `auto ${match[1]} → ${type}`, kind: 'variable' });
    }
    const scalar = /\b(?:bool|char|short|int|long|float|double|size_t|auto)\s+([A-Za-z_]\w*)\b(?!\s*\()/g;
    for (const match of code.matchAll(scalar)) {
        if (!analysis.symbols.some((item) => item.label === match[1])) {
            pushSymbol(analysis.symbols, { label: match[1], insertText: match[1], detail: 'Local C++ variable', kind: 'variable' });
        }
    }
    const functionPattern = /(?:^|[;}\n]\s*)(?:template\s*<[^>]+>\s*)?(?:[\w:<>,\[\]\s*&]+)\s+([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*(?:const\s*)?(?:noexcept\s*)?(?:\{|;)/gm;
    for (const match of code.matchAll(functionPattern)) {
        const name = match[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'main'].includes(name)) continue;
        const parameters = parameterNames(match[2], 'cpp');
        pushSymbol(analysis.symbols, {
            label: name, insertText: symbolSnippet(name, parameters), detail: `${name}(${match[2].trim()})`,
            documentation: 'Function declared in the current file.', kind: 'function', snippet: true, parameters,
        });
    }
    for (const match of code.matchAll(/\b(class|struct|enum)\s+([A-Za-z_]\w*)/g)) {
        pushSymbol(analysis.symbols, {
            label: match[2], insertText: match[2], detail: `${match[1]} declared in this file`,
            kind: match[1] === 'enum' ? 'enum' : 'class',
        });
    }
}

function inferPythonValue(value: string): string | undefined {
    const trimmed = value.trim();
    if (/^(?:[rubfRUBF]*)['"]/.test(trimmed)) return 'str';
    if (/^\[/.test(trimmed) || /^list\s*\(/.test(trimmed)) return 'list';
    if (/^\{/.test(trimmed)) return trimmed.includes(':') || trimmed === '{}' ? 'dict' : 'set';
    if (/^\(/.test(trimmed) || /^tuple\s*\(/.test(trimmed)) return 'tuple';
    if (/^dict\s*\(/.test(trimmed) || /^defaultdict\s*\(/.test(trimmed)) return 'dict';
    if (/^set\s*\(/.test(trimmed)) return 'set';
    if (/^deque\s*\(/.test(trimmed)) return 'deque';
    if (/^Counter\s*\(/.test(trimmed)) return 'Counter';
    return undefined;
}

function normalizePythonAnnotation(annotation: string): string | undefined {
    const base = annotation.trim().split(/\[|\s|\|/)[0];
    if (['List', 'Sequence', 'MutableSequence'].includes(base)) return 'list';
    if (['Dict', 'Mapping', 'MutableMapping'].includes(base)) return 'dict';
    if (['Set', 'AbstractSet'].includes(base)) return 'set';
    if (base === 'Tuple') return 'tuple';
    if (['str', 'list', 'dict', 'set', 'tuple', 'deque', 'Counter'].includes(base)) return base;
    return undefined;
}

function analyzePython(code: string, analysis: CompletionAnalysis) {
    for (const match of code.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+([A-Za-z_]\w*))?/gm)) {
        const name = match[2] || match[1].split('.')[0];
        const moduleName = match[1].split('.').at(-1) || match[1];
        analysis.variables.set(name, moduleName);
        pushSymbol(analysis.symbols, { label: name, insertText: name, detail: `Imported module ${match[1]}`, kind: 'module' });
    }
    for (const match of code.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?/gm)) {
        const name = match[3] || match[2];
        const inferred = ['deque', 'Counter', 'defaultdict'].includes(match[2]) ? match[2] : match[1].split('.').at(-1)!;
        analysis.variables.set(name, inferred);
        pushSymbol(analysis.symbols, { label: name, insertText: name, detail: `Imported from ${match[1]}`, kind: 'class' });
    }
    for (const match of code.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)) {
        const parameters = parameterNames(match[2], 'python').filter((item) => item !== 'self' && item !== 'cls');
        pushSymbol(analysis.symbols, {
            label: match[1], insertText: symbolSnippet(match[1], parameters), detail: `def ${match[1]}(${match[2].trim()})`,
            documentation: 'Function declared in the current file.', kind: 'function', snippet: true, parameters,
        });
        for (const parameter of match[2].split(',')) {
            const typed = parameter.trim().match(/^\**([A-Za-z_]\w*)\s*:\s*([^=]+)/);
            if (!typed) continue;
            const type = normalizePythonAnnotation(typed[2]);
            if (type) analysis.variables.set(typed[1], type);
            pushSymbol(analysis.symbols, { label: typed[1], insertText: typed[1], detail: `Function parameter: ${typed[2].trim()}`, kind: 'variable' });
        }
    }
    for (const match of code.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) {
        pushSymbol(analysis.symbols, { label: match[1], insertText: match[1], detail: 'Class declared in this file', kind: 'class' });
    }
    for (const match of code.matchAll(/^\s*([A-Za-z_]\w*)\s*(?::\s*([^=\n]+))?=\s*([^\n#]+)/gm)) {
        const type = (match[2] && normalizePythonAnnotation(match[2])) || inferPythonValue(match[3]);
        if (type) analysis.variables.set(match[1], type);
        pushSymbol(analysis.symbols, {
            label: match[1], insertText: match[1], detail: type ? `${match[1]}: ${type}` : 'Python variable', kind: 'variable',
        });
    }
}

function analyzeJava(code: string, analysis: CompletionAnalysis) {
    const knownTypes = 'ArrayList|List|Collection|LinkedList|ArrayDeque|Deque|Queue|PriorityQueue|HashMap|LinkedHashMap|Map|TreeMap|HashSet|Set|TreeSet|String|StringBuilder|Scanner|BufferedReader|StringTokenizer';
    const declaration = new RegExp(`\\b(${knownTypes})(?:\\s*<[^;\\n=(){}]+>)?\\s*(?:\\[\\])?\\s+([A-Za-z_$][\\w$]*)`, 'g');
    for (const match of code.matchAll(declaration)) {
        const type = normalizeJavaType(match[1]);
        analysis.variables.set(match[2], type);
        pushSymbol(analysis.symbols, { label: match[2], insertText: match[2], detail: `${match[1]} ${match[2]}`, kind: 'variable' });
    }
    const inferredDeclaration = new RegExp(`\\bvar\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*new\\s+(${knownTypes})\\b`, 'g');
    for (const match of code.matchAll(inferredDeclaration)) {
        const type = normalizeJavaType(match[2]);
        analysis.variables.set(match[1], type);
        pushSymbol(analysis.symbols, { label: match[1], insertText: match[1], detail: `var ${match[1]} → ${type}`, kind: 'variable' });
    }
    for (const match of code.matchAll(/\b(?:boolean|byte|char|short|int|long|float|double|String)\s*\[\]\s+([A-Za-z_$][\w$]*)/g)) {
        analysis.variables.set(match[1], 'Array');
        pushSymbol(analysis.symbols, { label: match[1], insertText: match[1], detail: `Java array ${match[1]}`, kind: 'variable' });
    }
    const scalar = /\b(?:boolean|byte|char|short|int|long|float|double|var)\s+([A-Za-z_$][\w$]*)\b(?!\s*\()/g;
    for (const match of code.matchAll(scalar)) {
        if (!analysis.symbols.some((item) => item.label === match[1])) {
            pushSymbol(analysis.symbols, { label: match[1], insertText: match[1], detail: 'Local Java variable', kind: 'variable' });
        }
    }
    const methodPattern = /(?:^|[;}\n]\s*)(?:(?:public|protected|private|static|final|synchronized|abstract|native)\s+)*(?:<[^>]+>\s*)?[\w<>\[\],.?]+\s+([A-Za-z_$][\w$]*)\s*\(([^;{}()]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*(?:\{|;)/gm;
    for (const match of code.matchAll(methodPattern)) {
        const name = match[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'main'].includes(name)) continue;
        const parameters = parameterNames(match[2], 'java');
        pushSymbol(analysis.symbols, {
            label: name, insertText: symbolSnippet(name, parameters), detail: `${name}(${match[2].trim()})`,
            documentation: 'Method declared in the current file.', kind: 'method', snippet: true, parameters,
        });
    }
    for (const match of code.matchAll(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)) {
        const kind = match[1] === 'interface' ? 'interface' : match[1] === 'enum' ? 'enum' : 'class';
        pushSymbol(analysis.symbols, { label: match[2], insertText: match[2], detail: `${match[1]} declared in this file`, kind });
    }
}

function applySyntaxFacts(analysis: CompletionAnalysis, facts: SyntaxFacts) {
    for (const variable of facts.variables) {
        if (!variable.type) continue;
        const type = normalizeSemanticType(analysis.language, variable.type);
        analysis.variables.set(variable.name, type);
        analysis.scopedVariables.push({ ...variable, type });
        pushSymbol(analysis.symbols, {
            label: variable.name,
            insertText: variable.name,
            detail: `${variable.name}: ${type} · Tree-sitter`,
            kind: 'variable',
        });
    }
    for (const item of facts.functions) {
        const returnType = item.returnType ? normalizeSemanticType(analysis.language, item.returnType) : undefined;
        if (returnType) analysis.functionReturns.set(item.name, returnType);
        pushSymbol(analysis.symbols, {
            label: item.name,
            insertText: symbolSnippet(item.name, item.parameters),
            detail: item.detail,
            documentation: 'Function parsed from the current syntax tree.',
            kind: 'function',
            snippet: true,
            parameters: item.parameters,
            returnType,
        });
    }
    for (const item of facts.members) {
        const members = analysis.typeMembers.get(item.owner) || [];
        const returnType = item.returnType ? normalizeSemanticType(analysis.language, item.returnType) : undefined;
        members.push(item.kind === 'method'
            ? method(item.name, item.parameters, item.detail, 'Member parsed from the current class.', returnType)
            : { ...field(item.name, item.detail, 'Field parsed from the current class.'), returnType });
        analysis.typeMembers.set(item.owner, members);
    }
}

export function analyzeCompletionDocument(
    code: string,
    language: string,
    syntaxFacts?: SyntaxFacts,
): CompletionAnalysis {
    const normalized = normalizeLanguage(language);
    const analysis: CompletionAnalysis = {
        language: normalized,
        variables: new Map(),
        symbols: [],
        scopedVariables: [],
        typeMembers: new Map(),
        functionReturns: new Map(),
        syntaxEngine: syntaxFacts?.engine || 'fallback',
    };
    for (const definition of GLOBAL_CALLS[normalized] || []) {
        if (definition.returnType) analysis.functionReturns.set(definition.label, definition.returnType);
    }
    const analysisCode = syntaxFacts?.maskedCode || code;
    if (normalized === 'cpp') analyzeCpp(analysisCode, analysis);
    else if (normalized === 'python') analyzePython(analysisCode, analysis);
    else if (normalized === 'java') analyzeJava(analysisCode, analysis);
    if (syntaxFacts?.language === normalized) applySyntaxFacts(analysis, syntaxFacts);
    const unique = new Map<string, IdeCompletionItem>();
    for (const item of analysis.symbols) {
        const key = `${item.kind}:${item.label}:${item.insertText}`;
        if (!unique.has(key)) unique.set(key, item);
    }
    analysis.symbols = Array.from(unique.values());
    return analysis;
}

function makeImportItems(values: string[], prefix: string, start: number, end: number, detail: string): IdeCompletionItem[] {
    return values.map((value) => ({ value, score: completionMatchScore(value, prefix) }))
        .filter((entry): entry is { value: string; score: number } => entry.score !== undefined)
        .sort((left, right) => left.score - right.score || left.value.localeCompare(right.value))
        .map((entry, index) => ({
            label: entry.value, insertText: entry.value, detail, kind: 'module',
            sortText: `00${entry.score.toString().padStart(3, '0')}${index.toString().padStart(3, '0')}`,
            replacement: { start, end },
        }));
}

function getImportCompletion(code: string, offset: number, language: string): IdeCompletionResult | undefined {
    const lineStart = code.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    const line = code.slice(lineStart, offset);
    if (language === 'cpp') {
        const match = line.match(/^\s*#\s*include\s*[<"]([^>"]*)$/);
        if (match) {
            const start = offset - match[1].length;
            return { context: 'include', exclusive: true, prefix: match[1], items: makeImportItems(CPP_HEADERS, match[1], start, offset, 'C++ standard header') };
        }
    }
    if (language === 'python') {
        const match = line.match(/^\s*(?:from\s+|import\s+)([\w.]*)$/);
        if (match) {
            const start = offset - match[1].length;
            return { context: 'import', exclusive: true, prefix: match[1], items: makeImportItems(PYTHON_MODULES, match[1], start, offset, 'Python standard library import') };
        }
    }
    if (language === 'java') {
        const match = line.match(/^\s*import\s+([\w.*]*)$/);
        if (match) {
            const start = offset - match[1].length;
            return { context: 'import', exclusive: true, prefix: match[1], items: makeImportItems(JAVA_IMPORTS, match[1], start, offset, 'Java standard library import') };
        }
    }
    return undefined;
}

function getVariableType(analysis: CompletionAnalysis, name: string, offset: number): string | undefined {
    const namedVariables = analysis.scopedVariables.filter((variable) => variable.name === name);
    const scoped = namedVariables
        .filter((variable) => variable.name === name
            && variable.start <= offset
            && variable.scopeStart <= offset
            && variable.scopeEnd >= offset)
        .sort((left, right) => right.start - left.start)[0];
    if (namedVariables.length) return scoped?.type;
    return analysis.variables.get(name);
}

function getMemberDefinitions(
    language: string,
    type: string,
    analysis?: CompletionAnalysis,
): MemberDefinition[] {
    const custom = analysis?.typeMembers.get(type) || [];
    const builtin = language === 'cpp'
        ? CPP_MEMBERS[type] || []
        : language === 'python'
            ? PYTHON_MEMBERS[type] || []
            : language === 'java'
                ? JAVA_MEMBERS[type] || []
                : [];
    const returnTypes = MEMBER_RETURN_TYPES[language]?.[type] || {};
    return [...custom, ...builtin].map((definition) => definition.returnType || !returnTypes[definition.label]
        ? definition
        : { ...definition, returnType: returnTypes[definition.label] });
}

function splitReceiver(receiver: string, language: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let roundDepth = 0;
    let squareDepth = 0;
    let angleDepth = 0;
    for (let index = 0; index < receiver.length; index += 1) {
        const character = receiver[index];
        if (character === '(') roundDepth += 1;
        else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
        else if (character === '[') squareDepth += 1;
        else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
        else if (character === '<' && language === 'cpp') angleDepth += 1;
        else if (character === '>' && language === 'cpp' && angleDepth) angleDepth -= 1;
        if (roundDepth || squareDepth || angleDepth) continue;
        const operatorLength = receiver.startsWith('->', index) || receiver.startsWith('::', index) ? 2
            : character === '.' ? 1 : 0;
        if (!operatorLength) continue;
        parts.push(receiver.slice(start, index).trim());
        start = index + operatorLength;
        index += operatorLength - 1;
    }
    parts.push(receiver.slice(start).trim());
    return parts.filter(Boolean);
}

function resolveReceiverType(
    language: string,
    receiver: string,
    analysis: CompletionAnalysis,
    offset: number,
): string | undefined {
    if (language === 'cpp' && receiver === 'std') return 'std';
    if (language === 'python' && PYTHON_MEMBERS[receiver]) return receiver;
    if (language === 'java' && JAVA_MEMBERS[receiver]) return receiver;
    const parts = splitReceiver(receiver, language);
    if (!parts.length) return undefined;
    const first = parts[0];
    const firstCall = first.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    let type = firstCall
        ? analysis.functionReturns.get(firstCall[1]) || normalizeSemanticType(language, firstCall[1])
        : getVariableType(analysis, first, offset);
    if (!type && analysis.typeMembers.has(first)) type = first;
    for (const part of parts.slice(1)) {
        if (!type) return undefined;
        const name = part.match(/^([A-Za-z_$][\w$]*)/)?.[1];
        if (!name) return undefined;
        const definition = getMemberDefinitions(language, type, analysis)
            .find((member) => member.label === name);
        type = definition?.returnType;
    }
    return type;
}

function getMemberCompletion(code: string, offset: number, analysis: CompletionAnalysis): IdeCompletionResult | undefined {
    const before = code.slice(0, offset);
    const atom = '[A-Za-z_$][\\w$]*(?:\\s*<[^;\\n()]+>)?(?:\\s*\\([^()\\n]*\\))?';
    const connector = analysis.language === 'cpp' ? '(?:\\.|->|::)' : '\\.';
    const pattern = new RegExp(`(${atom}(?:\\s*${connector}\\s*${atom})*)\\s*${connector}\\s*([A-Za-z_$][\\w$]*)?$`);
    const match = before.match(pattern);
    if (!match) return undefined;
    const receiver = match[1];
    const prefix = match[2] || '';
    const type = resolveReceiverType(analysis.language, receiver, analysis, offset);
    const replacement = { start: offset - prefix.length, end: offset };
    if (!type) return { context: 'member', exclusive: true, prefix, items: [] };
    const entries = getMemberDefinitions(analysis.language, type, analysis)
        .map((definition) => ({ definition, score: completionMatchScore(definition.label, prefix) }))
        .filter((entry): entry is { definition: MemberDefinition; score: number } => entry.score !== undefined)
        .sort((left, right) => left.score - right.score || left.definition.label.localeCompare(right.definition.label));
    return {
        context: 'member', exclusive: true, prefix,
        items: entries.map(({ definition, score }, index) => ({
            label: definition.label,
            insertText: definition.insertText || definition.label,
            detail: `${definition.detail}  —  ${receiver}: ${type}`,
            documentation: definition.documentation,
            kind: definition.kind || 'method',
            snippet: Boolean(definition.insertText),
            parameters: definition.parameters,
            returnType: definition.returnType,
            filterText: definition.label,
            sortText: `00${score.toString().padStart(3, '0')}${index.toString().padStart(3, '0')}`,
            replacement,
        })),
    };
}

function currentPrefix(code: string, offset: number): string {
    return code.slice(0, offset).match(/[A-Za-z_$][\w$]*$/)?.[0] || '';
}

export function getIdeCompletionResult(
    analysis: CompletionAnalysis,
    code: string,
    offset: number,
): IdeCompletionResult {
    const safeOffset = Math.max(0, Math.min(offset, code.length));
    const importCompletion = getImportCompletion(code, safeOffset, analysis.language);
    if (importCompletion) return importCompletion;
    const memberCompletion = getMemberCompletion(code, safeOffset, analysis);
    if (memberCompletion) return memberCompletion;
    const prefix = currentPrefix(code, safeOffset);
    const globalCalls: IdeCompletionItem[] = (GLOBAL_CALLS[analysis.language] || []).map((definition) => ({
        label: definition.label,
        insertText: definition.insertText || definition.label,
        detail: definition.detail,
        documentation: definition.documentation,
        kind: 'function',
        snippet: Boolean(definition.insertText),
        parameters: definition.parameters,
        returnType: definition.returnType,
        autoImport: true,
        sortText: '',
    }));
    const items = [...analysis.symbols, ...globalCalls]
        .filter((item) => {
            if (item.kind !== 'variable') return true;
            const scoped = analysis.scopedVariables.filter((variable) => variable.name === item.label);
            if (!scoped.length) return true;
            return scoped.some((variable) => variable.start <= safeOffset
                && variable.scopeStart <= safeOffset
                && variable.scopeEnd >= safeOffset);
        })
        .map((item) => ({ item, score: completionMatchScore(item.label, prefix) }))
        .filter((entry): entry is { item: IdeCompletionItem; score: number } => entry.score !== undefined)
        .filter(({ item }) => item.label.toLowerCase() !== prefix.toLowerCase())
        .sort((left, right) => left.score - right.score || left.item.label.localeCompare(right.item.label))
        .map(({ item, score }, index) => ({
            ...item,
            sortText: `${analysis.symbols.includes(item) ? '00' : '01'}${score.toString().padStart(3, '0')}${index.toString().padStart(3, '0')}`,
            replacement: { start: safeOffset - prefix.length, end: safeOffset },
        }));
    return { context: 'global', exclusive: false, prefix, items };
}

function findCallContext(code: string, offset: number): { callee: string; activeParameter: number } | undefined {
    let depth = 0;
    let openIndex = -1;
    for (let index = offset - 1; index >= 0; index -= 1) {
        const character = code[index];
        if (character === ')') depth += 1;
        else if (character === '(') {
            if (!depth) {
                openIndex = index;
                break;
            }
            depth -= 1;
        }
    }
    if (openIndex < 0) return undefined;
    const calleeMatch = code.slice(0, openIndex).match(/([A-Za-z_$][\w$]*(?:(?:\.|->|::)[A-Za-z_$][\w$]*)*)\s*$/);
    if (!calleeMatch) return undefined;
    let activeParameter = 0;
    let roundDepth = 0;
    let squareDepth = 0;
    let braceDepth = 0;
    let quote = '';
    for (let index = openIndex + 1; index < offset; index += 1) {
        const character = code[index];
        if (quote) {
            if (character === quote && code[index - 1] !== '\\') quote = '';
            continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '(') roundDepth += 1;
        else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
        else if (character === '[') squareDepth += 1;
        else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
        else if (character === '{') braceDepth += 1;
        else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
        else if (character === ',' && !roundDepth && !squareDepth && !braceDepth) activeParameter += 1;
    }
    return { callee: calleeMatch[1], activeParameter };
}

export function getIdeSignatureHelp(
    analysis: CompletionAnalysis,
    code: string,
    offset: number,
): IdeSignatureHelpResult | undefined {
    const context = findCallContext(code, Math.max(0, Math.min(offset, code.length)));
    if (!context) return undefined;
    const memberMatch = context.callee.match(/^(.*)(?:\.|->|::)([A-Za-z_$][\w$]*)$/);
    let definitions: MemberDefinition[] = [];
    if (memberMatch) {
        const type = resolveReceiverType(analysis.language, memberMatch[1], analysis, offset);
        if (type) definitions = getMemberDefinitions(analysis.language, type, analysis)
            .filter((definition) => definition.label === memberMatch[2] && definition.kind !== 'field');
    } else {
        const name = context.callee;
        definitions = (GLOBAL_CALLS[analysis.language] || []).filter((definition) => definition.label === name);
        for (const symbol of analysis.symbols.filter((item) => item.label === name && item.parameters)) {
            definitions.push({
                label: symbol.label,
                detail: symbol.detail,
                documentation: symbol.documentation,
                kind: 'method',
                parameters: symbol.parameters,
                returnType: symbol.returnType,
            });
        }
    }
    const unique = new Map<string, MemberDefinition>();
    for (const definition of definitions) unique.set(`${definition.detail}:${definition.parameters?.join(',')}`, definition);
    const signatures = Array.from(unique.values()).map((definition) => ({
        label: definition.detail,
        documentation: definition.documentation,
        parameters: (definition.parameters || []).map((parameter) => ({ label: parameter })),
    }));
    if (!signatures.length) return undefined;
    const widestSignature = Math.max(...signatures.map((signature) => signature.parameters.length));
    return {
        activeParameter: Math.min(context.activeParameter, Math.max(0, widestSignature - 1)),
        signatures,
    };
}
