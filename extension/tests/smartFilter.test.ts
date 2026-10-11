import { describe, expect, it } from 'vitest';
import { smartFilter } from '../src/content/smartFilter';

describe('smartFilter', () => {
    it('passes factual sentences, including ones without a recognised entity', () => {
        expect(smartFilter('Tesla reported 486,532 vehicle deliveries for the third quarter, topping estimates.').shouldCheck).toBe(true);
        expect(smartFilter("Analysts were expecting around 461,100 deliveries, according to StreetAccount's consensus.").shouldCheck).toBe(true);
        expect(smartFilter('Drinking bleach or disinfectant can kill the coronavirus inside the body.').shouldCheck).toBe(true);
    });

    it('drops fragments, questions and opinions', () => {
        expect(smartFilter('Too short to matter.')).toEqual({ shouldCheck: false, reason: 'too_short' });
        expect(smartFilter('Did Tesla really deliver that many vehicles in the third quarter?').reason).toBe('question');
        expect(smartFilter('I think the weather was lovely and everyone enjoyed the long walk.').reason).toBe('subjective');
        expect(smartFilter('In my opinion the new stadium is the best thing built here.').reason).toBe('subjective');
    });
});
