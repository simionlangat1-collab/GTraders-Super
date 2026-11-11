// G-K Pioneer brand mark for the dashboard header
import brandConfig from '@/../brand.config.json';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { BrandLogo } from './BrandLogo';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();
    const logoConfig = brandConfig.platform.logo;
    const logoUrl = logoConfig.link_url || '/';

    return (
        <a href={logoUrl} className='app-header__logo' aria-label={localize('G-K Pioneer home')}>
            <BrandLogo
                width={isDesktop ? 148 : 116}
                height={isDesktop ? 40 : 34}
            />
        </a>
    );
};
