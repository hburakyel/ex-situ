declare module 'lodash/debounce' {
    import { DebouncedFunc } from 'lodash';
    function debounce<T extends (...args: any) => any>(
        func: T,
        wait?: number,
        options?: any
    ): DebouncedFunc<T>;
    export default debounce;
}
