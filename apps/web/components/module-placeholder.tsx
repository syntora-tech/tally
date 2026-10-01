import { useTranslations } from 'next-intl';

type Props = {
  title: string;
  description: string;
  stage: string;
};

export function ModulePlaceholder({ title, description, stage }: Props) {
  const t = useTranslations('common');
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      <p className="text-sm text-muted-foreground">{t('comingAtStage', { stage })}</p>
    </div>
  );
}
