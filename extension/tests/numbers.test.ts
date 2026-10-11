import { describe, expect, it } from 'vitest';
import { compareFigures, extractQuantities } from '../src/verify/numbers';

describe('extractQuantities', () => {
    it('reads percentages, money and magnitudes', () => {
        const found = extractQuantities('Revenue rose 6% to $94.9 billion, with 1,234,567 units and 12 per cent growth.');
        expect(found.map(q => [q.value, q.kind])).toEqual([
            [6, 'percent'], [94.9e9, 'money'], [1234567, 'count'], [12, 'percent'],
        ]);
    });

    it('understands short and Indian magnitudes', () => {
        expect(extractQuantities('$5bn')[0].value).toBe(5e9);
        expect(extractQuantities('₹4,000')[0]).toMatchObject({ value: 4000, kind: 'money' });
        expect(extractQuantities('2 crore people')[0].value).toBe(2e7);
    });

    it('ignores years, dates and digits that are part of a name', () => {
        expect(extractQuantities('On 11 March 2020, COVID-19 spread while 5G towers and Q3 results made news.')).toEqual([]);
        expect(extractQuantities('March 4 and 31 January')).toEqual([]);
    });
});

describe('compareFigures', () => {
    it('reports a figure the source states differently', () => {
        expect(compareFigures(
            'Tesla delivered about 4.5 million vehicles worldwide in 2023.',
            'Tesla reported 485,000 deliveries for the fourth quarter, bringing 2023 total to 1.8 million',
        )).toEqual({ article: '4.5 million', source: '1.8 million' });
    });

    it('compares percentages regardless of size', () => {
        expect(compareFigures('Violent crime rose by 12% in 2024.', 'Violent crime fell 4.5% in 2024.'))
            .toEqual({ article: '12%', source: '4.5%' });
    });

    it('treats rounded figures as the same', () => {
        expect(compareFigures('Tesla delivered about 1.8 million vehicles.', 'Tesla delivered a record 1.81 million vehicles.')).toBeNull();
        expect(compareFigures('Canada passed 40 million people.', 'The population was 39.30 million.')).toBeNull();
    });

    it('does not compare figures of different kinds or scales', () => {
        expect(compareFigures('The bill costs $800 billion.', 'It was signed by 38 senators.')).toBeNull();
        expect(compareFigures('The city has 4 million residents.', 'There are 12 districts.')).toBeNull();
    });
});
