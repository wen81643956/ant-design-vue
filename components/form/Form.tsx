import type { PropType, ExtractPropTypes, HTMLAttributes, ComponentPublicInstance } from 'vue';
import { defineComponent, computed, watch, ref } from 'vue';
import PropTypes from '../_util/vue-types';
import classNames from '../_util/classNames';
import warning from '../_util/warning';
import type { FieldExpose } from './FormItem';
import FormItem from './FormItem';
import { getNamePath, containsNamePath, cloneByNamePathList } from './utils/valueUtil';
import { defaultValidateMessages } from './utils/messages';
import { allPromiseFinish } from './utils/asyncUtil';
import { toArray } from './utils/typeUtil';
import isEqual from 'lodash-es/isEqual';
import type { Options } from 'scroll-into-view-if-needed';
import scrollIntoView from 'scroll-into-view-if-needed';
import initDefaultProps from '../_util/props-util/initDefaultProps';
import { tuple } from '../_util/type';
import type { ColProps } from '../grid/Col';
import type {
  InternalNamePath,
  NamePath,
  RuleError,
  ValidateErrorEntity,
  ValidateOptions,
  Callbacks,
  ValidateMessages,
  Rule,
} from './interface';
import { useInjectSize } from '../_util/hooks/useSize';
import useConfigInject from '../_util/hooks/useConfigInject';
import { useProvideForm } from './context';
import type { SizeType } from '../config-provider';
import useForm from './useForm';

export type RequiredMark = boolean | 'optional';
export type FormLayout = 'horizontal' | 'inline' | 'vertical';

/** @deprecated Will warning in future branch. Pls use `Rule` instead. */
export type ValidationRule = Rule;

export const formProps = () => ({
  layout: PropTypes.oneOf(tuple('horizontal', 'inline', 'vertical')),
  labelCol: { type: Object as PropType<ColProps & HTMLAttributes> },
  wrapperCol: { type: Object as PropType<ColProps & HTMLAttributes> },
  colon: { type: Boolean, default: undefined },
  labelAlign: PropTypes.oneOf(tuple('left', 'right')),
  labelWrap: { type: Boolean, default: undefined },
  prefixCls: String,
  requiredMark: { type: [String, Boolean] as PropType<RequiredMark | ''>, default: undefined },
  /** @deprecated Will warning in future branch. Pls use `requiredMark` instead. */
  hideRequiredMark: { type: Boolean, default: undefined },
  model: PropTypes.object,
  rules: { type: Object as PropType<{ [k: string]: Rule[] | Rule }> },
  validateMessages: {
    type: Object as PropType<ValidateMessages>,
    default: undefined as ValidateMessages,
  },
  validateOnRuleChange: { type: Boolean, default: undefined },
  // 提交失败自动滚动到第一个错误字段
  scrollToFirstError: { type: [Boolean, Object] as PropType<boolean | Options> },
  onSubmit: Function as PropType<(e: Event) => void>,
  name: String,
  validateTrigger: { type: [String, Array] as PropType<string | string[]> },
  size: { type: String as PropType<SizeType> },
  onValuesChange: { type: Function as PropType<Callbacks['onValuesChange']> },
  onFieldsChange: { type: Function as PropType<Callbacks['onFieldsChange']> },
  onFinish: { type: Function as PropType<Callbacks['onFinish']> },
  onFinishFailed: { type: Function as PropType<Callbacks['onFinishFailed']> },
  onValidate: { type: Function as PropType<Callbacks['onValidate']> },
});

export type FormProps = Partial<ExtractPropTypes<ReturnType<typeof formProps>>>;

export type FormExpose = {
  resetFields: (name?: NamePath) => void;
  clearValidate: (name?: NamePath) => void;
  validateFields: (
    nameList?: NamePath[] | string,
    options?: ValidateOptions,
  ) => Promise<{
    [key: string]: any;
  }>;
  getFieldsValue: (nameList?: InternalNamePath[] | true) => {
    [key: string]: any;
  };
  validate: (
    nameList?: NamePath[] | string,
    options?: ValidateOptions,
  ) => Promise<{
    [key: string]: any;
  }>;
  scrollToField: (name: NamePath, options?: {}) => void;
};

export type FormInstance = ComponentPublicInstance<FormProps, FormExpose>;

function isEqualName(name1: NamePath, name2: NamePath) {
  return isEqual(toArray(name1), toArray(name2));
}

const Form = defineComponent({
  name: 'AForm',
  inheritAttrs: false,
  props: initDefaultProps(formProps(), {
    layout: 'horizontal',
    hideRequiredMark: false,
    colon: true,
  }),
  Item: FormItem,
  useForm,
  // emits: ['finishFailed', 'submit', 'finish', 'validate'],
  setup(props, { emit, slots, expose, attrs }) {
    const size = useInjectSize(props);
    const { prefixCls, direction, form: contextForm } = useConfigInject('form', props);
    const requiredMark = computed(() => props.requiredMark === '' || props.requiredMark);
    const mergedRequiredMark = computed(() => {
      if (requiredMark.value !== undefined) {
        return requiredMark.value;
      }

      if (contextForm && contextForm.value?.requiredMark !== undefined) {
        return contextForm.value.requiredMark;
      }

      if (props.hideRequiredMark) {
        return false;
      }
      return true;
    });
    const mergedColon = computed(() => props.colon ?? contextForm.value?.colon);
    const validateMessages = computed(() => {
      return {
        ...defaultValidateMessages,
        ...contextForm.value?.validateMessages,
        ...props.validateMessages,
      };
    });
    const formClassName = computed(() =>
      classNames(prefixCls.value, {
        [`${prefixCls.value}-${props.layout}`]: true,
        [`${prefixCls.value}-hide-required-mark`]: mergedRequiredMark.value === false,
        [`${prefixCls.value}-rtl`]: direction.value === 'rtl',
        [`${prefixCls.value}-${size.value}`]: size.value,
      }),
    );
    const lastValidatePromise = ref();
    const fields: Record<string, FieldExpose> = {};
    const addField = (eventKey: string, field: FieldExpose) => {
      fields[eventKey] = field;
    };
    const removeField = (eventKey: string) => {
      delete fields[eventKey];
    };

    const getFieldsByNameList = (nameList: NamePath[]) => {
      const provideNameList = !!nameList;
      const namePathList = provideNameList ? toArray(nameList).map(getNamePath) : [];
      if (!provideNameList) {
        return Object.values(fields);
      } else {
        return Object.values(fields).filter(
          field =>
            namePathList.findIndex(namePath => isEqualName(namePath, field.fieldName.value)) > -1,
        );
      }
    };
    const resetFields = (name?: NamePath) => {
      if (!props.model) {
        warning(false, 'Form', 'model is required for resetFields to work.');
        return;
      }
      getFieldsByNameList(name ? [name] : undefined).forEach(field => {
        field.resetField();
      });
    };
    const clearValidate = (name?: NamePath) => {
      getFieldsByNameList(name ? [name] : undefined).forEach(field => {
        field.clearValidate();
      });
    };
    const handleFinishFailed = (errorInfo: ValidateErrorEntity) => {
      const { scrollToFirstError } = props;
      emit('finishFailed', errorInfo);
      if (scrollToFirstError && errorInfo.errorFields.length) {
        let scrollToFieldOptions: Options = {};
        if (typeof scrollToFirstError === 'object') {
          scrollToFieldOptions = scrollToFirstError;
        }
        scrollToField(errorInfo.errorFields[0].name, scrollToFieldOptions);
      }
    };
    const validate = (...args: any[]) => {
      return validateField(...args);
    };
    const scrollToField = (name?: NamePath, options = {}) => {
      const fields = getFieldsByNameList(name ? [name] : undefined);
      if (fields.length) {
        const fieldId = fields[0].fieldId.value;
        const node = fieldId ? document.getElementById(fieldId) : null;

        if (node) {
          scrollIntoView(node, {
            scrollMode: 'if-needed',
            block: 'nearest',
            ...options,
          });
        }
      }
    };
    // eslint-disable-next-line no-unused-vars
    const getFieldsValue = (nameList: InternalNamePath[] | true = true) => {
      if (nameList === true) {
        const allNameList = [];
        Object.values(fields).forEach(({ namePath }) => {
          allNameList.push(namePath.value);
        });
        return cloneByNamePathList(props.model, allNameList);
      } else {
        return cloneByNamePathList(props.model, nameList);
      }
    };
    const validateFields = (nameList?: NamePath[], options?: ValidateOptions) => {
      warning(
        !(nameList instanceof Function),
        'Form',
        'validateFields/validateField/validate not support callback, please use promise instead',
      );
      if (!props.model) {
        warning(false, 'Form', 'model is required for validateFields to work.');
        return Promise.reject('Form `model` is required for validateFields to work.');
      }
      const provideNameList = !!nameList;
      const namePathList: InternalNamePath[] = provideNameList
        ? toArray(nameList).map(getNamePath)
        : [];

      // Collect result in promise list
      const promiseList: Promise<{
        name: InternalNamePath;
        errors: string[];
      }>[] = [];

      Object.values(fields).forEach(field => {
        // Add field if not provide `nameList`
        if (!provideNameList) {
          namePathList.push(field.namePath.value);
        }

        // Skip if without rule
        if (!field.rules?.value.length) {
          return;
        }

        const fieldNamePath = field.namePath.value;

        // Add field validate rule in to promise list
        if (!provideNameList || containsNamePath(namePathList, fieldNamePath)) {
          const promise = field.validateRules({
            validateMessages: validateMessages.value,
            ...options,
          });

          // Wrap promise with field
          promiseList.push(
            promise
              .then<any, RuleError>(() => ({ name: fieldNamePath, errors: [], warnings: [] }))
              .catch((ruleErrors: RuleError[]) => {
                const mergedErrors: string[] = [];
                const mergedWarnings: string[] = [];

                ruleErrors.forEach(({ rule: { warningOnly }, errors }) => {
                  if (warningOnly) {
                    mergedWarnings.push(...errors);
                  } else {
                    mergedErrors.push(...errors);
                  }
                });

                if (mergedErrors.length) {
                  return Promise.reject({
                    name: fieldNamePath,
                    errors: mergedErrors,
                    warnings: mergedWarnings,
                  });
                }

                return {
                  name: fieldNamePath,
                  errors: mergedErrors,
                  warnings: mergedWarnings,
                };
              }),
          );
        }
      });

      const summaryPromise = allPromiseFinish(promiseList);
      lastValidatePromise.value = summaryPromise;

      const returnPromise = summaryPromise
        .then(() => {
          if (lastValidatePromise.value === summaryPromise) {
            return Promise.resolve(getFieldsValue(namePathList));
          }
          return Promise.reject([]);
        })
        .catch(results => {
          const errorList = results.filter(result => result && result.errors.length);
          return Promise.reject({
            values: getFieldsValue(namePathList),
            errorFields: errorList,
            outOfDate: lastValidatePromise.value !== summaryPromise,
          });
        });

      // Do not throw in console
      returnPromise.catch(e => e);

      return returnPromise;
    };
    const validateField = (...args: any[]) => {
      return validateFields(...args);
    };

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      emit('submit', e);
      if (props.model) {
        const res = validateFields();
        res
          .then(values => {
            emit('finish', values);
          })
          .catch(errors => {
            handleFinishFailed(errors);
          });
      }
    };
    expose({
      resetFields,
      clearValidate,
      validateFields,
      getFieldsValue,
      validate,
      scrollToField,
    } as FormExpose);

    useProvideForm({
      model: computed(() => props.model),
      name: computed(() => props.name),
      labelAlign: computed(() => props.labelAlign),
      labelCol: computed(() => props.labelCol),
      labelWrap: computed(() => props.labelWrap),
      wrapperCol: computed(() => props.wrapperCol),
      vertical: computed(() => props.layout === 'vertical'),
      colon: mergedColon,
      requiredMark: mergedRequiredMark,
      validateTrigger: computed(() => props.validateTrigger),
      rules: computed(() => props.rules),
      addField,
      removeField,
      onValidate: (name, status, errors) => {
        emit('validate', name, status, errors);
      },
      validateMessages,
    });

    watch(
      () => props.rules,
      () => {
        if (props.validateOnRuleChange) {
          validateFields();
        }
      },
    );

    return () => {
      return (
        <form {...attrs} onSubmit={handleSubmit} class={[formClassName.value, attrs.class]}>
          {slots.default?.()}
        </form>
      );
    };
  },
});

export default Form as typeof Form & {
  readonly Item: typeof FormItem;
  readonly useForm: typeof useForm;
};
